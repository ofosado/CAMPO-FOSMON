import React, { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";
// ── GENERADOR DE PDF DESDE EL APP ────────────────────────────────────────
async function generarPDFObra(obra, subs, estimaciones, maquinaria, materiales) {
  // ── CARGA DE LIBRERÍAS ────────────────────────────────────────────────────
  if (!window.jspdf) {
    await new Promise((res,rej)=>{ const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }
  await new Promise((res,rej)=>{
    if(window._atLoaded) return res();
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
    s.onload=()=>{window._atLoaded=true;res();}; s.onerror=rej; document.head.appendChild(s);
  });
  const { jsPDF } = window.jspdf;

  try {
  // ── CONSTANTES DE DISEÑO ──────────────────────────────────────────────────
  // Página letter landscape: 279 × 216 mm
  const PW=279, PH=216;
  const ML=14, MR=14, MT=16, MB=14;  // márgenes
  const HDR=14, FTR=10;               // header y footer
  const CW=PW-ML-MR;                  // 251mm ancho de contenido
  const CY0=HDR+MT;                   // Y inicio contenido = 27mm
  const CYmax=PH-FTR-MB;             // Y máximo = 192mm → 165mm disponibles

  // Tipografía
  const FS_SEC=10;   // section header
  const FS_TH=8;     // table header
  const FS_TD=8.5;   // table body
  const FS_SM=7.5;   // small / notas
  const FS_KL=7;     // KPI label
  const FS_KV=15;    // KPI value grande
  const FS_FI=8.5;   // firmas

  // Paleta
  const K = {
    ng:[13,22,25], wh:[255,255,255],
    bg:[240,242,245], glt:[248,249,251], gbd:[220,223,228],
    gtx:[85,94,107], gmu:[154,160,172],
    vd:[99,153,34], vk:[59,109,17], vb:[234,243,222],
    rd:[226,75,74], rk:[163,45,45], rb:[252,235,235],
    az:[55,138,221], ak:[24,95,165], ab:[230,241,251],
    am:[239,159,39], ak2:[133,79,11], ab2:[250,238,218],
    mo:[127,119,221], mk:[60,52,137], mb:[238,237,254],
    na:[217,119,6],
  };

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'letter'});
  const pf   = n => parseFloat(n)||0;
  const MXN  = n => `$${Math.abs(n||0).toLocaleString('es-MX',{minimumFractionDigits:0,maximumFractionDigits:0})}`;
  const PCT  = (n,d=1) => `${(n||0).toFixed(d)}%`;
  const hoy  = new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});

  // KPIs derivados — con campos reales del app
  const matActivos = materiales.filter(m=>m.desc&&m.desc.trim()&&pf(m.imp)>0);
  const maqActivos = maquinaria.filter(m=>m.desc&&m.desc.trim()&&pf(m.imp)>0);
  const totAlm  = matActivos.reduce((t,m)=>t+pf(m.imp),0);
  const totMaq  = maqActivos.reduce((t,m)=>t+pf(m.imp),0);
  const totGP   = pf(obra.gastoGP);
  const totGast = totGP + totMaq;
  const am      = subs.reduce((t,s)=>t+(s.a/100)*s.imp,0);
  const me      = am + totAlm;
  const af      = subs.reduce((t,s)=>t+(s.a/100)*(s.imp/obra.presupuesto)*100,0);
  const mg      = me - totGast;
  const mpct    = me>0 ? mg/me*100 : 0;
  const PPTO    = obra.presupuesto||1;
  const te      = estimaciones.reduce((t,e)=>t+e.monto,0);
  // Normalizar estatus para comparación robusta (sin importar acentos o mayúsculas)
  const normEst = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const pag     = estimaciones.filter(e=>normEst(e.estatus)==='pagada').reduce((t,e)=>t+e.monto,0);
  const pco     = estimaciones.filter(e=>['facturada','aprobada'].includes(normEst(e.estatus))).reduce((t,e)=>t+e.monto,0);
  const epc     = estimaciones.filter(e=>normEst(e.estatus).includes('proceso')).reduce((t,e)=>t+e.monto,0);

  let pagNum = 0;

  // ── DRAW HELPERS ──────────────────────────────────────────────────────────
  const sf = c => doc.setFillColor(...c);
  const sd = c => doc.setDrawColor(...c);
  const st = c => doc.setTextColor(...c);
  const fs = n => doc.setFontSize(n);
  const fw = s => doc.setFont('helvetica',s);
  const lw = n => doc.setLineWidth(n);
  const R  = (x,y,w,h,sty='F') => doc.rect(x,y,w,h,sty);
  const L  = (x1,y1,x2,y2) => doc.line(x1,y1,x2,y2);
  const T  = (s,x,y,o={}) => doc.text(String(s||''),x,y,o);

  // Dibuja header/footer en página actual
  function pageFrame() {
    pagNum++;
    // Header: fondo negro
    sf(K.ng); R(0,0,PW,HDR);
    // Barra azul decorativa izquierda
    sf(K.ak); R(0,0,3,HDR);
    // Logo FOSMON
    // Logo: 447×516 ratio. A 8mm de alto → ancho = 8/1.154 = 6.9mm. Centrado en HDR=13mm
    try { if(typeof EMB_WHITE!=='undefined')
      doc.addImage(EMB_WHITE,'PNG',ML,2,6.9,8,'','FAST');
    } catch(e){}
    // Textos header — todo en una línea centrada verticalmente
    st(K.wh); fs(9); fw('bold');
    T('CAMPO', ML+10, 5);
    fs(6.5); fw('normal');
    T('Reporte de Avance · FOSMON Construcciones', ML+10, 9.5);
    fs(8); fw('bold');
    T(obra.nombre||'', PW-MR, 5, {align:'right'});
    fs(6.5); fw('normal');
    T(`${obra.contrato||''} · ${hoy}`, PW-MR, 9.5, {align:'right'});
    // Footer
    sf([232,234,240]); R(0,PH-FTR,PW,FTR);
    sf(K.ng); R(0,PH-FTR,PW,0.6);
    st(K.gmu); fs(6); fw('normal');
    T('CAMPO — FOSMON Construcciones · Documento confidencial', ML, PH-3.5);
    T(`Página ${pagNum} de 8`, PW/2, PH-3.5, {align:'center'});
    T('campo-fosmon.netlify.app', PW-MR, PH-3.5, {align:'right'});
  }

  // Dibuja una sección header (barra oscura + título)
  function secHead(txt, y, col=K.ng) {
    sf(col); R(ML,y,CW,8);
    sf(K.wh); R(ML,y,2,8);
    st(K.wh); fs(FS_SEC); fw('bold');
    T(txt, ML+5, y+5.8);
    return y+8+3; // retorna Y siguiente
  }

  // Dibuja un KPI box — retorna nada, dibuja directo
  function kpiBox(lbl,val,sub,col,x,y,w) {
    const h=18;
    sf(K.wh); sd(K.gbd); lw(0.2); R(x,y,w,h,'FD');
    sf(col); R(x,y,1.5,h);
    st(K.gmu); fs(FS_KL); fw('normal'); T(lbl.toUpperCase(), x+3, y+5);
    st(K.ng); fs(val.length>9?10:FS_KV); fw('bold'); T(val, x+3, y+13);
    st(K.gmu); fs(FS_KL); fw('normal'); T(sub, x+3, y+17);
  }

  // Dibuja fila de N KPIs — retorna Y siguiente
  function kpiRow(items, y) {
    const n=items.length, gap=2;
    const w=(CW-(n-1)*gap)/n;
    items.forEach(([lbl,val,sub,col],i)=>{
      kpiBox(lbl,val,sub,col, ML+i*(w+gap), y, w);
    });
    return y+20;
  }

  // Tabla autoTable con posición X explícita — clave para 2 columnas sin solapamiento
  function autoT(head, body, colW, x, y, opts={}) {
    const tableW = colW.reduce((s,w)=>s+w,0);
    const base = {
      head:[head], body,
      startY: y,
      margin: {left:x, right:PW-x-tableW},
      tableWidth: tableW,
      styles: {
        fontSize:FS_TD, cellPadding:2.2,
        textColor:K.gtx, lineColor:K.gbd, lineWidth:0.2,
        font:'helvetica', fontStyle:'normal',
        overflow:'linebreak',
      },
      headStyles: {
        fillColor:K.ng, textColor:K.wh,
        fontSize:FS_TH, fontStyle:'bold',
        cellPadding:2.2,
      },
      alternateRowStyles: { fillColor:K.glt, textColor:K.gtx },
      columnStyles: {},
      ...opts,
    };
    colW.forEach((w,i)=>{ base.columnStyles[i]={cellWidth:w}; });
    doc.autoTable(base);
    return doc.lastAutoTable.finalY + 3;
  }

  // Línea separadora
  function hrLine(y) {
    sd(K.gbd); lw(0.2); L(ML,y,ML+CW,y); return y+2;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAG 1 — PORTADA
  // ════════════════════════════════════════════════════════════════════════
  pagNum=1;
  // Mitad izquierda oscura
  sf(K.ng); R(0,0,PW*0.42,PH);
  // Mitad derecha clara
  sf(K.bg); R(PW*0.42,0,PW*0.58,PH);

  // Logo FOSMON izquierda — 22×35.8mm (ratio 447:516 → h=w*1.154)
  try {
    if(typeof EMB_WHITE!=='undefined')
      doc.addImage(EMB_WHITE,'PNG',ML,22,22,25.4,'','FAST');
  } catch(e){}

  // Textos izquierda
  st(K.wh); fs(26); fw('bold'); T('CAMPO', ML, 58);
  fs(7.5); fw('normal'); T('REPORTE DE AVANCE DE OBRA', ML, 64);
  sd(K.wh); lw(0.4); L(ML, 66.5, ML+55, 66.5);
  fs(13); fw('bold');
  const nomLines=doc.splitTextToSize(obra.nombre||'',PW*0.38);
  T(nomLines, ML, 74);
  fs(7.5); fw('normal');
  T(obra.ubicacion||'FOSMON Construcciones', ML, 82);

  // Datos contrato derecha
  const xR=PW*0.44, yR0=22;
  st(K.ng); fs(9); fw('bold'); T('Datos del contrato', xR, yR0);
  sd(K.gbd); lw(0.3); L(xR, yR0+2, PW-MR, yR0+2);
  let yR=yR0+7;
  [['Contrato:',obra.contrato||''],
   ['Cliente:',obra.cliente||''],
   ['Superintendente:',obra.superintendente||''],
   ['Residente:',obra.residente||''],
   ['Administrador:',obra.admin||''],
   ['Inicio de obra:',obra.inicio||''],
   ['Fin programado:',obra.fin||''],
   ['Presupuesto:',MXN(PPTO)],
   ['Corte del reporte:',hoy],
  ].forEach(([lbl,val])=>{
    st(K.ng); fs(7); fw('bold'); T(lbl, xR, yR);
    st(K.gtx); fw('normal');
    T(doc.splitTextToSize(String(val),PW-xR-MR-28), xR+30, yR);
    yR+=5;
  });

  // 4 KPIs portada — fila horizontal
  const kpY=PH-28, kpW=(PW*0.50)/4-2, kpX=PW*0.44;
  [[`Avance`,PCT(af),'del presupuesto', af>=75?K.vk:af>=40?K.am:K.rd],
   ['Ejecutado',MXN(me),PCT(me/PPTO*100)+' contrato',K.ak],
   ['Gasto GP',MXN(totGast),PCT(totGast/PPTO*100)+' presup.',K.rk],
   ['Margen',PCT(mpct),MXN(mg),mpct<10?K.rk:mpct<15?K.ak2:K.vk],
  ].forEach(([lbl,val,sub,col],i)=>{
    const x=kpX+i*(kpW+2);
    sf(K.wh); sd(col); lw(0.3); R(x,kpY,kpW,16,'FD');
    sf(col); R(x,kpY,1.5,16);
    st(K.gmu); fs(6); fw('normal'); T(lbl.toUpperCase(),x+3,kpY+5);
    st(K.ng); fs(val.length>9?9:11); fw('bold'); T(val,x+3,kpY+12);
  });

  // Footer portada
  sf([232,234,240]); R(0,PH-FTR,PW,FTR);
  sf(K.ng); R(0,PH-FTR,PW,0.6);
  st(K.gmu); fs(6); fw('normal');
  T('CAMPO — Control de Avance, Maquinaria, Personal y Obra · FOSMON Construcciones', ML, PH-3.5);
  T('campo-fosmon.netlify.app', PW-MR, PH-3.5, {align:'right'});

  // ════════════════════════════════════════════════════════════════════════
  // PAG 2 — RESUMEN FINANCIERO
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  let y=CY0;

  y=secHead('1  RESUMEN FINANCIERO', y);
  y=kpiRow([
    ['Avance fisico',   PCT(af),         PCT(af)+' del presupuesto',   K.vk],
    ['Monto ejecutado', MXN(me),         PCT(me/PPTO*100)+' contrato', K.ak],
    ['Gasto total GP',  MXN(totGast),    PCT(totGast/PPTO*100)+' presup.',K.rk],
    ['Margen bruto',    PCT(mpct),       MXN(mg),                       mpct<10?K.rk:mpct<15?K.ak2:K.vk],
    ['Total estimado',  MXN(te),         PCT(te/PPTO*100)+' contrato', K.mk],
    ['Por estimar',     MXN(PPTO-te),    PCT((PPTO-te)/PPTO*100)+' rest.',K.gtx],
  ], y)+2;

  // ── 2 columnas usando X explícita ─────────────────────────────────────
  const LW=CW*0.42, RW=CW-LW-5;
  const xL=ML, xR2=ML+LW+5;

  // Columna izquierda: datos del contrato
  const contBody=[
    ['Contrato',obra.contrato||''],['Cliente',obra.cliente||''],
    ['Inicio',obra.inicio||''],['Fin programado',obra.fin||''],
    ['Superintendente',obra.superintendente||''],
    ['Residente',obra.residente||''],['Administrador',obra.admin||''],
    ['Presupuesto',MXN(PPTO)],
  ];
  const yAfterCont = autoT(
    ['Campo','Valor'], contBody,
    [LW*0.38,LW*0.62], xL, y,
    {didParseCell:(d)=>{
      if(d.column.index===0){d.cell.styles.fontStyle='bold';d.cell.styles.textColor=K.ng;}
    }}
  );

  // Columna derecha: gasto por rubro — misma Y de inicio
  const rubros=[['Materiales',13203452],['Sueldos y salarios',11677695],
    ['Indirectos',3547181],['Renta y maquinaria',652372],['Subcontratos',249500]];
  const totRub=rubros.reduce((t,r)=>t+r[1],0);
  const rubBody=[
    ...rubros.map(([nm,mt])=>[nm,MXN(mt),PCT(mt/totRub*100),PCT(mt/PPTO*100)]),
    ['TOTAL GP',MXN(totRub),'100.0%',PCT(totRub/PPTO*100)],
  ];
  const yAfterRub = autoT(
    ['Rubro','Monto','% GP','% Ppto'], rubBody,
    [RW*0.46,RW*0.22,RW*0.16,RW*0.16], xR2, y,
    {columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'}},
     didParseCell:(d)=>{
       if(d.row.index===rubros.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
     }}
  );
  y=Math.max(yAfterCont, yAfterRub)+2;

  // ── Estimaciones — tabla única ancho completo ──────────────────────────
  y=secHead('2  ESTIMACIONES AL CLIENTE', y);

  // Tabla estimaciones — anchos fijos que suman LW3 exacto
  const LW3=CW*0.66, RW3=CW-LW3-4;
  // No.(18) + Periodo(50) + MontoBruto(38) + Anticipo(34) + FGar(34) + MtoEfectivo(38) + Estatus(LW3-resto)
  const estW=[ 18, 50, 38, 34, 34, 38, LW3-18-50-38-34-34-38 ].map(Math.round);

  const estBody=estimaciones.map(e=>{
    const a=e.monto*(obra.pctAnticipo||10)/100;
    const fg=e.monto*(obra.pctFondoGar||5)/100;
    const ef=e.monto-a-fg;
    return [`EST-0${e.no}`,e.periodo||'',MXN(e.monto),MXN(a),MXN(fg),MXN(ef),e.estatus];
  });
  const aT=te*(obra.pctAnticipo||10)/100;
  const fgT=te*(obra.pctFondoGar||5)/100;
  estBody.push(['TOTAL','',MXN(te),MXN(aT),MXN(fgT),MXN(te-aT-fgT),'']);

  const EST_COLS_MAP={1:{halign:'left'},2:{halign:'right'},3:{halign:'right'},
                      4:{halign:'right'},5:{halign:'right'}};
  const EST_STATUS_COLORS={
    'pagada':K.vk,'facturada':K.mk,'en proceso':K.ak2,'aprobada':K.vk,
  };

  const yEstStart=y;
  const yAfterEst=autoT(
    ['No.','Periodo','Monto bruto','Anticipo','F. Garantia','Mto. efectivo','Estatus'],
    estBody, estW, xL, y,
    {columnStyles:EST_COLS_MAP,
     didParseCell:(d)=>{
       const ri=d.row.index;
       if(ri===estBody.length-1){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
       if(d.column.index===6 && ri<estBody.length-1){
         const estNorm=normEst(estimaciones[ri]?.estatus||'');
         const col=EST_STATUS_COLORS[estNorm]||K.gtx;
         d.cell.styles.textColor=col; d.cell.styles.fontStyle='bold';
       }
     }}
  );

  // 4 KPIs de estimaciones apilados a la derecha
  const kpHe=15, kpGap=2;
  [[`Pagado`,MXN(pag),'liquidado',K.vk],
   ['Por cobrar',MXN(pco),'facturado + aprobado',K.mk],
   ['En proceso',MXN(epc),'en elaboración',K.ak2],
   ['Total est.',MXN(te),PCT(te/PPTO*100)+' del contrato',K.ak],
  ].forEach(([lbl,val,sub,col],i)=>{
    const bx=ML+LW3+4, by=yEstStart+i*(kpHe+kpGap);
    sf(K.wh); sd(K.gbd); lw(0.2); R(bx,by,RW3,kpHe,'FD');
    sf(col); R(bx,by,1.5,kpHe);
    st(K.gmu); fs(FS_KL); fw('normal'); T(lbl.toUpperCase(), bx+3, by+4.5);
    st(K.ng); fs(val.length>9?8:11); fw('bold'); T(val, bx+3, by+10.5);
    st(K.gmu); fs(6); fw('normal'); T(sub, bx+3, by+14);
  });

  // ════════════════════════════════════════════════════════════════════════
  // PAG 3 — AVANCE FÍSICO + ALMACÉN + MAQUINARIA
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;
  y=secHead('3  AVANCE FÍSICO POR SUBSECCIÓN', y);

  // Tabla avance — columnas fijas sumando CW exacto
  const subsActivos=subs.filter(s=>s.imp>0);
  const totImp=subsActivos.reduce((t,s)=>t+s.imp,0);
  const totEjec=subsActivos.reduce((t,s)=>t+(s.a/100)*s.imp,0);

  // Anchos: Sec(16) + Desc(90) + Importe(38) + Avance%(18) + Barra(55) + Mto.Ejec(34) = 251
  const AV_SEC=16, AV_DESC=90, AV_IMP=38, AV_PCT=18, AV_BAR=55, AV_EJEC=CW-AV_SEC-AV_DESC-AV_IMP-AV_PCT-AV_BAR;
  const avHead=['Sec.','Descripción','Importe contrato','Avance','Progreso','Mto. ejecutado'];
  const avBody=subsActivos.map(s=>{
    const ejec=(s.a/100)*s.imp;
    return [s.sec, s.sub||'', MXN(s.imp), PCT(s.a), '', MXN(ejec)];
  });
  avBody.push(['','TOTAL',MXN(totImp),PCT(af),'',MXN(totEjec)]);

  autoT(avHead, avBody,
    [AV_SEC,AV_DESC,AV_IMP,AV_PCT,AV_BAR,AV_EJEC],
    ML, y,
    {columnStyles:{
       0:{halign:'left'},1:{halign:'left'},
       2:{halign:'right'},3:{halign:'center',fontStyle:'bold'},
       4:{halign:'left'},5:{halign:'right'},
     },
     didParseCell:(d)=>{
       const ri=d.row.index;
       if(ri===subsActivos.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
         return;
       }
       const s=subsActivos[ri];
       if(!s) return;
       if(d.column.index===3){
         d.cell.styles.textColor=s.a>=75?K.vk:s.a>=40?K.ak2:K.rk;
       }
       if(d.column.index===5){
         d.cell.styles.textColor=K.ak;
       }
     },
     // Dibujar barras de progreso DENTRO de la celda con didDrawCell
     didDrawCell:(d)=>{
       if(d.column.index!==4) return;
       if(d.row.index>=subsActivos.length) return;
       const s=subsActivos[d.row.index];
       if(!s) return;
       const px=d.cell.x+1, py=d.cell.y+d.cell.height/2-1.5;
       const pw=d.cell.width-2, ph=3;
       const pct=Math.min(s.a/100,1);
       const col=s.a>=75?K.vd:s.a>=40?K.am:K.rd;
       sf(K.gbd); doc.rect(px,py,pw,ph,'F');
       if(pct>0){ sf(col); doc.rect(px,py,pw*pct,ph,'F'); }
     }
    }
  );
  y=doc.lastAutoTable.finalY+5;

  // ── Almacén + Maquinaria en 2 columnas ──────────────────────────────────
  y=secHead('Almacén · Materiales en tránsito · Maquinaria propia', y);

  const LW5=CW*0.56, RW5=CW-LW5-5;
  const matBody=[
    ...matActivos.map(m=>[m.desc||'',m.concepto||'',m.vol||'',m.und||'',MXN(pf(m.imp))]),
    ['TOTAL ALMACÉN','','','',MXN(totAlm)],
  ];
  const yAM=autoT(
    ['Material','Condición','Vol.','Und','Importe'], matBody,
    [LW5*0.40,LW5*0.22,LW5*0.10,LW5*0.10,LW5*0.18],
    ML, y,
    {columnStyles:{2:{halign:'right'},4:{halign:'right'}},
     didParseCell:(d)=>{
       if(d.row.index===matActivos.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
     }}
  );

  const maqBody=[
    ...maqActivos.map(m=>[m.desc||'',m.vol||'',m.und||'',MXN(pf(m.imp))]),
    ['TOTAL MAQUINARIA','','',MXN(totMaq)],
  ];
  const yMQ=autoT(
    ['Equipo','Cant.','Unidad','Importe'], maqBody,
    [RW5*0.62,RW5*0.12,RW5*0.11,RW5*0.15],
    ML+LW5+5, y,
    {columnStyles:{1:{halign:'center'},3:{halign:'right'}},
     didParseCell:(d)=>{
       if(d.row.index===maqActivos.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
     }}
  );
  y=Math.max(yAM,yMQ);

  // ════════════════════════════════════════════════════════════════════════
  // PAG 4 — PROYECCIÓN Y PLAZOS
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;
  y=secHead('4  PROYECCIÓN AL TÉRMINO · PLAZOS DE OBRA', y);

  // ── Gráfica de proyección ────────────────────────────────────────────────
  // Área: CW × 52mm
  const GX=ML, GY=y, GW=CW, GH=52;
  const GPL=20, GPB=8, GPR=16, GPT=8;
  const gw=GW-GPL-GPR, gh=GH-GPB-GPT;
  const semsReales=5, semsTot=15;
  const ritmoG=totGP/1e6/semsReales||0.1;
  const ritmoM=me/1e6/semsReales||0.1;
  const PM=PPTO/1e6;
  const maxV=Math.max(PM, totGP/1e6*2)*1.1;

  const gxP=i=>GX+GPL+i/(semsTot-1)*gw;
  const gyP=v=>GY+GPT+(1-Math.min(v,maxV)/maxV)*gh;

  // Fondo blanco con borde
  sf(K.wh); sd(K.gbd); lw(0.2); R(GX+GPL,GY+GPT,gw,gh,'FD');

  // Grid Y
  [0,maxV*0.25,maxV*0.5,maxV*0.75,maxV].forEach(v=>{
    const gy2=gyP(v);
    sd(K.gbd); lw(0.15); doc.setLineDashPattern([2,2],0);
    if(v<maxV) L(GX+GPL,gy2,GX+GPL+gw,gy2);
    doc.setLineDashPattern([],0);
    st(K.gmu); fs(6); fw('normal');
    T(`$${v.toFixed(0)}M`, GX+GPL-1, gy2+1.5, {align:'right'});
  });
  // Línea presupuesto
  sf(K.ng); lw(0.4); doc.setLineDashPattern([3,2],0);
  L(GX+GPL, gyP(PM), GX+GPL+gw, gyP(PM));
  doc.setLineDashPattern([],0);
  st(K.ng); fs(6); fw('bold'); T('Ppto', GX+GPL+gw+1, gyP(PM)+1.5);

  // Generar datos de gráfica
  const grafData=Array.from({length:semsTot},(_,i)=>{
    const real=i<semsReales;
    const g=real?totGP/1e6*(i+1)/semsReales:totGP/1e6+(i-semsReales+1)*ritmoG;
    const m=real?me/1e6*(i+1)/semsReales:me/1e6+(i-semsReales+1)*ritmoM;
    return {i,g:Math.min(g,PM),m:Math.min(m,PM),real};
  });
  const hoyIdx=semsReales-1;

  // Zona sombreada hasta plazo
  sf([244,250,240]); R(gxP(hoyIdx),GY+GPT,gxP(semsTot-1)-gxP(hoyIdx),gh,'F');

  // Línea HOY
  sd(K.gmu); lw(0.4); doc.setLineDashPattern([1.5,2],0);
  L(gxP(hoyIdx),GY+GPT,gxP(hoyIdx),GY+GPT+gh);
  doc.setLineDashPattern([],0);
  st(K.gmu); fs(5.5); fw('normal'); T('Hoy',gxP(hoyIdx),GY+GPT+gh+5,{align:'center'});

  // Línea plazo final
  sd(K.vk); lw(0.5); doc.setLineDashPattern([3,2],0);
  L(gxP(semsTot-1),GY+GPT,gxP(semsTot-1),GY+GPT+gh);
  doc.setLineDashPattern([],0);
  st(K.vk); fs(5.5); fw('bold'); T('Plazo',gxP(semsTot-1),GY+GPT-1,{align:'center'});

  // X labels
  [0,2,4,6,hoyIdx,8,10,12,14].forEach(i=>{
    const bold=i===hoyIdx;
    st(bold?K.ng:K.gmu); fs(5.5); fw(bold?'bold':'normal');
    T(`S${14+i}`,gxP(i),GY+GPT+gh+5,{align:'center'});
  });

  // Líneas de datos
  [[1,K.rk,'g'],[2,K.ak,'m']].forEach(([_,col,key])=>{
    sd(col);
    // Real (sólida, gruesa)
    lw(0.9); doc.setLineDashPattern([],0);
    for(let i=0;i<hoyIdx;i++)
      L(gxP(i),gyP(grafData[i][key]),gxP(i+1),gyP(grafData[i+1][key]));
    // Proyectada (punteada)
    lw(0.6); doc.setLineDashPattern([3,3],0);
    for(let i=hoyIdx;i<semsTot-1;i++)
      L(gxP(i),gyP(grafData[i][key]),gxP(i+1),gyP(grafData[i+1][key]));
    doc.setLineDashPattern([],0);
    // Punto HOY
    sf(col); doc.circle(gxP(hoyIdx),gyP(grafData[hoyIdx][key]),1.5,'F');
    // Etiqueta
    st(col); fs(6); fw('bold');
    const off=key==='g'?-2:2;
    T(`$${grafData[hoyIdx][key].toFixed(1)}M`, gxP(hoyIdx)+3, gyP(grafData[hoyIdx][key])+off);
  });

  // Leyenda
  st(K.gtx); fs(6); fw('normal');
  sf(K.rk); R(GX+GPL,GY+GPT+gh+9,10,2,'F');
  T('Gasto GP',GX+GPL+12,GY+GPT+gh+11);
  sf(K.ak); R(GX+GPL+45,GY+GPT+gh+9,10,2,'F');
  T('Monto ejecutado',GX+GPL+57,GY+GPT+gh+11);
  st(K.gmu); T('— — proyección',GX+GPL+108,GY+GPT+gh+11);
  y=GY+GH+16;

  // ── Tablas de proyección en 2 columnas ────────────────────────────────
  const semsRest=semsTot-semsReales;
  const metaG=(PM-totGP/1e6)/semsRest, metaM=(PM-me/1e6)/semsRest;
  const finG=Math.ceil(14+semsReales+(PM-totGP/1e6)/ritmoG);
  const finM=Math.ceil(14+semsReales+(PM-me/1e6)/ritmoM);
  const LW6=CW*0.55, RW6=CW-LW6-5;

  const proyBody=[
    ['Ritmo semanal gasto',`$${ritmoG.toFixed(1)}M/sem`,'al ritmo actual de GP'],
    ['Ritmo semanal avance',`$${ritmoM.toFixed(1)}M/sem`,'al ritmo actual de avance'],
    ['Fin proyectado gasto',`S${finG}`,'al ritmo actual'],
    ['Fin proyectado avance',`S${finM}`,'al ritmo actual'],
    ['Meta gasto p/plazo',`$${metaG.toFixed(1)}M/sem`,`+$${(metaG-ritmoG).toFixed(1)}M/sem requerido`],
    ['Meta avance p/plazo',`$${metaM.toFixed(1)}M/sem`,`+$${(metaM-ritmoM).toFixed(1)}M/sem requerido`],
    ['Plazo original',obra.fin||'','contrato original'],
    ['Plazo ampliado',obra.finAmpliado||'No registrado',obra.finAmpliado?'Convenio modificatorio':'Sin ampliación registrada'],
  ];
  const yPL=autoT(
    ['Indicador','Valor','Referencia'], proyBody,
    [LW6*0.50,LW6*0.23,LW6*0.27], ML, y,
    {columnStyles:{1:{halign:'right',fontStyle:'bold',textColor:K.ng}}}
  );

  const plazBody=[
    ['Inicio contrato',obra.inicio||''],
    ['Corte actual',hoy],
    ['Fin programado',obra.fin||''],
    ['Fin proy. gasto',`S${finG}`],
    ['Días transcurridos',obra.diasTranscurridos||'—'],
    ['Días restantes',obra.diasRestantes||'—'],
  ];
  const yPR=autoT(
    ['Hito','Fecha/Valor'], plazBody,
    [RW6*0.60,RW6*0.40], ML+LW6+5, y,
    {columnStyles:{1:{halign:'right'}}}
  );
  y=Math.max(yPL,yPR);

  // ════════════════════════════════════════════════════════════════════════
  // PAG 5 — PERSONAL · NÓMINA · PROVEEDORES · MAQUINARIA
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;
  y=secHead('5  PERSONAL EN CAMPO · NÓMINA · TOP PROVEEDORES', y);

  const nomData=typeof NOMINA_S18!=='undefined'?NOMINA_S18:[];
  const dir=nomData.filter(p=>p.tipo==='D').length;
  const ind=nomData.filter(p=>p.tipo==='I').length;
  const tot=dir+ind||66;
  const conHE=nomData.filter(p=>(p.horasExtra||0)>0).length||53;

  y=kpiRow([
    ['Total personal',String(tot),'trabajadores en sitio',K.ng],
    ['Directo',String(dir),'mano de obra',K.ak],
    ['Indirecto',String(ind),'administración',K.mk],
    ['Con horas extra',String(conHE),'semana actual',K.ak2],
  ], y)+2;

  const LW7=CW*0.50, RW7=CW-LW7-5;

  // Top 5 nómina
  const nom5=nomData.slice().sort((a,b)=>(b.total||0)-(a.total||0)).slice(0,5);
  const nomBody=nom5.map((pe,i)=>[
    i+1, pe.nombre||'', pe.categoria||pe.cat||'',
    `${(pe.horasExtra||0).toFixed(0)}h`, MXN(pe.total||0),
  ]);
  const yNom=autoT(
    ['#','Trabajador','Categoría','HE hrs','Total semana'], nomBody,
    [8,LW7*0.44,LW7*0.28,LW7*0.12,LW7*0.16], ML, y,
    {columnStyles:{0:{halign:'center'},3:{halign:'right'},4:{halign:'right'}},
     didParseCell:(d)=>{
       if(d.column.index===3){
         const he=parseFloat(d.cell.text[0])||0;
         d.cell.styles.textColor=he>=20?K.rk:K.ak2;
         d.cell.styles.fontStyle='bold';
       }
       if(d.column.index===4){d.cell.styles.fontStyle='bold';d.cell.styles.textColor=K.ng;}
     }}
  );

  // Top 5 proveedores
  const provs=obra.proveedores||[
    ['FOSMON CONSTRUCCIONES S.A.',4280794],['JUAN ANTONIO BENITEZ F.',2412104],
    ['CEMEX S A B DE C V',1817638],['IMSS',1636496],['JOSE E. ALEGRIA CUETO',1426787],
  ];
  const totPv=provs.reduce((t,p)=>t+p[1],0);
  const pvBody=provs.map(([nm,mt],i)=>[i+1,nm.slice(0,28),MXN(mt),PCT(mt/Math.max(totGP,1)*100)]);
  const yPv=autoT(
    ['#','Proveedor','Monto acumulado','% Gasto GP'], pvBody,
    [8,RW7*0.52,RW7*0.28,RW7*0.20], ML+LW7+5, y,
    {columnStyles:{0:{halign:'center'},2:{halign:'right'},3:{halign:'right'}}}
  );
  y=Math.max(yNom,yPv)+3;

  y=secHead('Maquinaria propia en obra', y);
  const maq2Body=[
    ...maqActivos.map(m=>[m.desc||'',m.vol||'',m.und||'',MXN(pf(m.pu||0)),MXN(pf(m.imp))]),
    ['TOTAL MAQUINARIA','','','',MXN(totMaq)],
  ];
  autoT(
    ['Equipo','Cant.','Unidad','P.U.','Importe'], maq2Body,
    [CW*0.53,CW*0.08,CW*0.10,CW*0.15,CW*0.14], ML, y,
    {columnStyles:{1:{halign:'center'},3:{halign:'right'},4:{halign:'right'}},
     didParseCell:(d)=>{
       if(d.row.index===maqActivos.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
     }}
  );

  // ════════════════════════════════════════════════════════════════════════
  // PAG 6 — INDICADORES DE RIESGO · OBSERVACIONES
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;
  y=secHead('6  INDICADORES DE RIESGO · OBSERVACIONES', y);

  const rsgBody=[
    [1,'Brecha avance vs gasto','+0.8pp','Normal',K.vk,K.vb,'Avance y gasto alineados'],
    [2,'Velocidad quema presupuesto','1.04x','Vigilancia',K.ak2,K.ab2,'Ritmo ligeramente acelerado'],
    [3,'Estimaciones sin cobrar',PCT((pco+epc)/Math.max(te,1)*100),'Vigilancia',K.ak2,K.ab2,'Monto pendiente de cobro'],
    [4,'Frentes sin iniciar',String(subs.filter(s=>s.a===0).length),'Vigilancia',K.ak2,K.ab2,'Frentes con avance 0%'],
    [5,'Concentración proveedores','54%','Vigilancia',K.ak2,K.ab2,'Top 3 = 54% del gasto GP'],
    [6,'Incremento nómina s/s','+15%','Vigilancia',K.ak2,K.ab2,'Incremento moderado, revisar HE'],
    [7,'Trabajadores HE ≥ 20hrs',String(nomData.filter(p=>(p.horasExtra||0)>=20).length||8)+' pers.','Crítico',K.rk,K.rb,'8 trabajadores con HE excesivas'],
  ];

  const rsgBodyClean=rsgBody.map(([n,titulo,val,,tc,,desc])=>[n,titulo,val,rsgBody.find(r=>r[0]===n)?.[3]||'',desc]);
  const col4w=CW-10-CW*0.29-36-46-6;
  autoT(
    ['#','Indicador','Valor','Nivel','Descripción'], rsgBodyClean,
    [10,CW*0.29,36,46,col4w], ML, y,
    {columnStyles:{0:{halign:'center'},2:{halign:'right',fontStyle:'bold'},3:{halign:'center',fontStyle:'bold'}},
     didParseCell:(d)=>{
       if(d.column.index===3){
         const r=rsgBody[d.row.index];
         if(r){d.cell.styles.textColor=r[4]; d.cell.styles.fillColor=r[5];}
       }
     }}
  );
  y=doc.lastAutoTable.finalY+5;

  y=secHead('Observaciones y alertas', y);
  const obs=[
    [K.ak2,K.ab2,'VIGILANCIA',`Margen bruto ${PCT(mpct)} — revisar productividad y desperdicios.`],
    [K.ak,K.ab,'PENDIENTE',`EST en proceso ${MXN(epc)} — gestionar cobro prioritario con el cliente.`],
    [K.rk,K.rb,'CRÍTICO','Trabajadores con HE ≥ 20hrs — revisar organización de turnos.'],
    [K.mk,K.mb,'FINANCIERO',`Anticipo por recuperar: ${MXN(te*(obra.pctAnticipo||10)/100)}`],
  ];

  // Tabla plana de observaciones
  const obsBody=obs.map(([tc,bg,nv,txt])=>[nv,txt]);
  autoT(
    ['Nivel','Observación'], obsBody,
    [26,CW-26], ML, y,
    {columnStyles:{0:{halign:'center',fontStyle:'bold'},1:{halign:'left'}},
     didParseCell:(d)=>{
       const r=obs[d.row.index];
       if(!r) return;
       if(d.column.index===0){d.cell.styles.textColor=r[0]; d.cell.styles.fillColor=r[1];}
     }}
  );

  // ════════════════════════════════════════════════════════════════════════
  // PAGS 7-8 — FOTOGRAFÍAS
  // ════════════════════════════════════════════════════════════════════════
  const fotosAll=[];
  subs.forEach(s=>{
    const fArr=Array.isArray(s.fotos)?s.fotos:Object.values(s.fotos||{});
    fArr.forEach(f=>fotosAll.push({sec:s.sec,sub:s.sub||'',conc:f.conc||f.concepto||'',fecha:f.fecha||hoy,url:f.url||null}));
  });

  const FOTOS_DEF=[
    {sec:'A1.4',   conc:'Piso recinto negro 10×10cm',   fecha:'27 May 2026'},
    {sec:'A1.4',   conc:'Guía podotáctil instalada',    fecha:'27 May 2026'},
    {sec:'A1.7.1', conc:'Relleno base hidráulica',      fecha:'25 May 2026'},
    {sec:'A1.7.1', conc:'Firme concreto MR-42',          fecha:'25 May 2026'},
    {sec:'A1.3',   conc:'Instalación tubería PEAD',     fecha:'24 May 2026'},
    {sec:'A1.3',   conc:'Acostillado y relleno',        fecha:'24 May 2026'},
    {sec:'B1.9.1', conc:'Cisterna — colado muros',      fecha:'23 May 2026'},
    {sec:'B1.7',   conc:'Acceso vehicular — base',      fecha:'22 May 2026'},
    {sec:'B1.4',   conc:'Andador Calle Const.',          fecha:'21 May 2026'},
    {sec:'A1.5',   conc:'Jardinería — nivelación',      fecha:'20 May 2026'},
    {sec:'B1.7B',  conc:'Sist. infiltración — zanja',   fecha:'19 May 2026'},
    {sec:'B1.10.1',conc:'Mobiliario — replanteo',       fecha:'18 May 2026'},
  ];
  const fotos12=fotosAll.length>=6?fotosAll.slice(0,12):FOTOS_DEF;

  const FW=(CW-8)/3, FH=FW*0.64;

  function drawFotoPage(fotos6, title) {
    doc.addPage(); pageFrame();
    let yf=CY0;
    yf=secHead(title, yf)+2;
    // 2 filas × 3 fotos
    for(let row=0;row<2;row++){
      const rowF=fotos6.slice(row*3,(row+1)*3);
      rowF.forEach((foto,col)=>{
        const fx=ML+col*(FW+4), fy=yf;
        // Placeholder / foto
        sf(K.bg); sd(K.gbd); lw(0.2); R(fx,fy,FW,FH,'FD');
        if(foto.url){
          try{ doc.addImage(foto.url,'JPEG',fx,fy,FW,FH,'','FAST'); }catch(e){}
        } else {
          st(K.gmu); fs(10); fw('bold'); T(foto.sec,fx+FW/2,fy+FH/2-3,{align:'center'});
          fs(6); fw('normal'); T('Sin foto — Capturar avance',fx+FW/2,fy+FH/2+4,{align:'center'});
        }
        // Pie de foto
        sf(K.ng); R(fx,fy+FH,FW,7,'F');
        st(K.wh); fs(7); fw('bold'); T(foto.sec,fx+2,fy+FH+4.5);
        fs(6); fw('normal'); st(K.gmu);
        T((foto.conc||'').slice(0,32),fx+2,fy+FH+6.5);
        T(foto.fecha||'',fx+FW-1,fy+FH+6.5,{align:'right'});
      });
      yf+=FH+7+4;
    }
    st(K.gmu); fs(6.5); fw('normal');
    T('Las fotos se agregan desde Capturar avance → Volúmenes.',ML,yf);
    return yf+6;
  }

  let yF2=drawFotoPage(fotos12.slice(0,6), '7  EVIDENCIA FOTOGRÁFICA (1 de 2)');
  drawFotoPage(fotos12.slice(6,12), '8  EVIDENCIA FOTOGRÁFICA (2 de 2)');

  // Firmas al final de pág 8
  const yFirmas=PH-FTR-38;
  sd(K.gbd); lw(0.3); L(ML,yFirmas,ML+CW,yFirmas);
  const fw3=CW/3;
  const firmas=[
    [obra.residente||obra.superintendente||'Residente','Residente de Obra','Elaboró'],
    [obra.superintendente||'Superintendente','Superintendente de Obra','Revisó'],
    [obra.admin||'Administrador','Administrador de Obra','Vo.Bo.'],
  ];
  firmas.forEach(([nombre,cargo,rol],i)=>{
    const fx=ML+i*fw3;
    sd(K.ng); lw(0.4); L(fx+8,yFirmas+14,fx+fw3-8,yFirmas+14);
    st(K.ng); fs(FS_FI); fw('bold'); T(nombre,fx+fw3/2,yFirmas+20,{align:'center'});
    st(K.gtx); fs(7.5); fw('normal'); T(cargo,fx+fw3/2,yFirmas+26,{align:'center'});
    st(K.gmu); fs(7); T(rol,fx+fw3/2,yFirmas+31,{align:'center'});
  });

  // ── GUARDAR ──────────────────────────────────────────────────────────────
  const nombre=`Reporte_CAMPO_${(obra.nombre||'Obra').replace(/\s+/g,'_')}_${hoy.replace(/\s+/g,'_')}.pdf`;
  doc.save(nombre);

  } catch(e) {
    console.error('Error generando PDF:',e);
    alert(`Error al generar PDF:\n${e.message}\n\nRevisa la consola (F12) para más detalle.`);
  }
}
// ── ERROR BOUNDARY — muestra el error en pantalla en lugar de pantalla blanca ──
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:24,background:"#0D1619",minHeight:"100vh",color:"#fff",fontFamily:"monospace"}}>
          <div style={{background:"#DC2626",borderRadius:8,padding:"12px 16px",marginBottom:16,fontSize:14,fontWeight:700}}>
             Error en CAMPO
          </div>
          <div style={{background:"#141E22",borderRadius:8,padding:16,fontSize:12,lineHeight:1.6,wordBreak:"break-all"}}>
            <b>{this.state.error.toString()}</b>
            <pre style={{marginTop:12,fontSize:11,opacity:0.7,overflow:"auto"}}>
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}



// ── PALETA FOSMON ──────────────────────────────────────────────────────────
const C = {
  // Tema claro
  bg:      "#F0F2F5",
  surface: "#FFFFFF",
  card:    "#FFFFFF",
  border:  "#E8EAF0",
  borderM: "#D0D4DC",
  caliza:  "#0D1619",
  textPri: "#0D1619",
  textSec: "#555E6B",
  textMut: "#9AA0AC",
  // Colores semánticos
  green:   "#639922",
  greenBg: "#EAF3DE",
  greenDk: "#3B6D11",
  red:     "#E24B4A",
  redBg:   "#FCEBEB",
  redDk:   "#A32D2D",
  blue:    "#378ADD",
  blueBg:  "#E6F1FB",
  blueDk:  "#185FA5",
  yellow:  "#EF9F27",
  yellowBg:"#FAEEDA",
  yellowDk:"#854F0B",
  purple:  "#7F77DD",
  purpleBg:"#EEEDFE",
  purpleDk:"#3C3489",
  orange:  "#D97706",
  orangeBg:"#FEF3C7",
  pink:    "#F43F5E",
  indigo:  "#6366F1",
};

// ── FIREBASE CONFIG ────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDCKc0ymTK_PX8_20xrMnsyhLtGyLWmlek",
  authDomain: "campo-fosmon.firebaseapp.com",
  projectId: "campo-fosmon",
  storageBucket: "campo-fosmon.firebasestorage.app",
  messagingSenderId: "737456981212",
  appId: "1:737456981212:web:96980bd464a382d620e019",
};

const fbApp  = initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);
const fbDb   = getFirestore(fbApp);
const fbStor = getStorage(fbApp);

// Helpers Firestore
const fsGet  = async (path) => { try { const d = await getDoc(doc(fbDb, ...path.split('/'))); return d.exists() ? d.data() : null; } catch { return null; } };
const fsSet  = async (path, data) => { try { await setDoc(doc(fbDb, ...path.split('/')), data, {merge:true}); return true; } catch(e) { console.error('fsSet',e); return false; } };
const fsDel  = async (path) => { try { await deleteDoc(doc(fbDb, ...path.split('/'))); return true; } catch { return false; } };
const fsColl = async (path) => { try { const s = await getDocs(collection(fbDb, ...path.split('/'))); return s.docs.map(d=>({id:d.id,...d.data()})); } catch { return []; } };

// Helper Storage — subir foto base64 y obtener URL
const uploadFoto = async (obraId, conceptoId, fotoId, base64url) => {
  try {
    const r = storageRef(fbStor, `obras/${obraId}/fotos/${conceptoId}/${fotoId}`);
    await uploadString(r, base64url, 'data_url');
    return await getDownloadURL(r);
  } catch(e) { console.error('uploadFoto',e); return base64url; }
};

// Mapa de roles por correo — se carga desde Firestore
// Si no existe en Firestore, usa este default
const ROLES_DEFAULT = {
  "ofosado@fosmon.com.mx":   { rol:"director_general",    nombre:"Oscar Fosado Monsalvo" },
  "ofosadog@fosmon.com.mx":  { rol:"director_operaciones", nombre:"Dir. de Operaciones" },
  "aoliva@fosmon.com.mx":    { rol:"gerente_construccion", nombre:"Alejandro Noe Oliva Somellera" },
  "pcastillo@fosmon.com.mx": { rol:"administrador_obra",   nombre:"Pablo Castillo Villalobos" },
};


// ── EMBLEMA FOSMON ─────────────────────────────────────────────────────────
const EMB_WHITE = "data:image/png;base64,"
  + "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"
  + "AElFTkSuQmCC";
const EMB_NEGRO = "data:image/png;base64,"
  + "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";
function EmblemaFOSMON({ size=22, dark=false, opacity=1 }) {
  const h = Math.round(size * 516/447);
  return <img src={dark?EMB_NEGRO:EMB_WHITE} alt="FOSMON"
    style={{display:"block",flexShrink:0,opacity,imageRendering:"crisp-edges",
      width:size,height:h,objectFit:"contain"}}/>;
}

// ── ROLES Y USUARIOS ───────────────────────────────────────────────────────
// Usuarios ahora en Firebase Auth + Firestore

const ROL_LABEL = {
  director_general:    "Director General",
  director_operaciones:"Director de Operaciones",
  gerente_construccion:"Gerente de Construcción",
  administrador_obra:  "Administrador de Obra",
};

// Permisos: can(rol, modulo, accion)
// acciones: 'ver' | 'editar'
// modulos: 'dash','captura','gastos','estimaciones','riesgo','personal_detalle','todas_obras'
const PERMISOS = {
  director_general:    { dash:"ver", captura:null,      gastos:"ver",    estimaciones:"ver",    riesgo:"ver", todas_obras:true  },
  director_operaciones:{ dash:"ver", captura:"editar",  gastos:"editar", estimaciones:"editar", riesgo:"ver", todas_obras:true  },
  gerente_construccion:{ dash:"ver", captura:"editar",  gastos:"ver",    estimaciones:"ver",    riesgo:"ver", todas_obras:true  },
  administrador_obra:  { dash:"ver", captura:"editar",  gastos:"editar", estimaciones:"editar", riesgo:"ver", todas_obras:false },
};

function can(rol, modulo, accion="ver") {
  const p = PERMISOS[rol];
  if (!p) return false;
  const v = p[modulo];
  if (!v) return false;
  if (accion === "ver") return v === "ver" || v === "editar";
  return v === "editar";
}

const css = `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:${C.bg}; color:${C.textPri}; font-family:system-ui,-apple-system,sans-serif; }
  ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#F0F2F5}
  ::-webkit-scrollbar-thumb{background:#D0D4DC;border-radius:2px}
  input,select{font-family:inherit;outline:none}
  input:focus,select:focus{border-color:${C.blueDk}!important;box-shadow:0 0 0 2px ${C.blueBg}}
  button{cursor:pointer;font-family:inherit}
  .fotodrop{border:1.5px dashed ${C.borderM};border-radius:8px;padding:8px;
    text-align:center;cursor:pointer;font-size:10px;color:${C.textMut};transition:all .2s;
    background:${C.bg};}
  .fotodrop:hover{border-color:${C.blueDk};color:${C.blueDk};background:${C.blueBg}}
  .fotothumb{position:relative;border-radius:8px;overflow:hidden;aspect-ratio:4/3;cursor:zoom-in}
  .fotothumb img{width:100%;height:100%;object-fit:cover;display:block}
  .fotodel{position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);border:none;
    color:#fff;width:20px;height:20px;border-radius:50%;font-size:11px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s}
  .fotothumb:hover .fotodel{opacity:1}
  .lb{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;
    display:flex;align-items:center;justify-content:center;padding:16px;cursor:pointer}
  .lb img{max-width:90vw;max-height:85vh;border-radius:10px;object-fit:contain}
  input[type=range]{accent-color:${C.blueDk};width:100%}
  .noscroll::-webkit-scrollbar{display:none}
`;

// ── HELPERS ────────────────────────────────────────────────────────────────
const MXN = n=>(Math.abs(n)||0).toLocaleString("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0});
const NUM = (n,d=1)=>Number(n||0).toLocaleString("es-MX",{maximumFractionDigits:d});
const semA = p=>p>=85?C.green:p>=55?C.yellow:C.red;
const semM = p=>p>15?C.green:p>=6?C.yellow:C.red;

// ── ATOMS ──────────────────────────────────────────────────────────────────
function Card({children,style,accent}){
  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
    padding:"11px 13px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",
    ...(accent?{borderLeft:`3px solid ${accent}`,borderRadius:"0 10px 10px 0"}:{}),...style}}>{children}</div>;
}
function Tit({children}){
  return <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginBottom:8,letterSpacing:"0.01em"}}>{children}</div>;
}
function Kpi({label,value,sub,color,size=15}){
  return <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
    padding:"8px 10px",borderLeft:`3px solid ${color}`,boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
    <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{label}</div>
    <div style={{fontSize:size,fontWeight:600,color,lineHeight:1.2}}>{value}</div>
    {sub&&<div style={{fontSize:9,color:C.textMut,marginTop:2}}>{sub}</div>}
  </div>;
}
function Bar({pct,color}){
  return <div style={{background:C.bg,borderRadius:99,height:4,overflow:"hidden"}}>
    <div style={{width:`${Math.min(pct||0,100)}%`,height:"100%",background:color||C.blueDk,borderRadius:99,transition:"width .4s"}}/>
  </div>;
}
function Bdg({children,color,small,bgColor}){
  // Map semantic colors to proper light-mode bg
  const bgMap = {
    [C.green]:C.greenBg,[C.greenDk]:C.greenBg,
    [C.red]:C.redBg,[C.redDk]:C.redBg,
    [C.blue]:C.blueBg,[C.blueDk]:C.blueBg,
    [C.yellow]:C.yellowBg,[C.yellowDk]:C.yellowBg,
    [C.purple]:C.purpleBg,[C.purpleDk]:C.purpleBg,
  };
  const bg = bgColor || bgMap[color] || `${color}18`;
  const textCol = {[C.green]:C.greenDk,[C.red]:C.redDk,[C.blue]:C.blueDk,
    [C.yellow]:C.yellowDk,[C.purple]:C.purpleDk}[color] || color;
  return <span style={{background:bg,color:textCol,borderRadius:99,
    padding:small?"1px 7px":"2px 9px",fontSize:small?9:10,fontWeight:500,whiteSpace:"nowrap",
    display:"inline-block"}}>{children}</span>;
}
function Inp({style,...rest}){
  return <input {...rest} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
    padding:"6px 9px",color:C.textPri,fontSize:11,width:"100%",...style}}/>;
}
function Sel({children,style,...rest}){
  return <select {...rest} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
    padding:"6px 9px",color:C.textPri,fontSize:11,...style}}>{children}</select>;
}
function PrimaryBtn({children,onClick,disabled}){
  return <button onClick={onClick} disabled={disabled}
    style={{background:disabled?C.border:C.blueDk,border:"none",borderRadius:8,padding:10,
      color:disabled?C.textMut:"#fff",fontSize:12,fontWeight:500,width:"100%",marginTop:6,
      letterSpacing:"0.02em",cursor:disabled?"not-allowed":"pointer"}}>{children}</button>;
}
function SecBtn({children,onClick,style}){
  return <button onClick={onClick} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
    padding:"5px 10px",fontSize:11,color:C.textSec,...style}}>{children}</button>;
}
function ReadOnly({children}){
  return <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:9,
    color:C.yellow,background:"rgba(202,138,4,0.12)",borderRadius:4,padding:"2px 7px",
    border:"0.5px solid rgba(202,138,4,0.25)",marginLeft:8}}> Solo lectura</div>;
}

function Lightbox({url,onClose}){
  if(!url)return null;
  return <div className="lb" onClick={onClose}><img src={url} alt=""/></div>;
}
function FotoUploader({fotos,onAdd,onDel}){
  const ref=useRef(); const[lb,setLb]=useState(null);
  const leer=useCallback(files=>{
    Array.from(files).filter(f=>f.type.startsWith("image/")).forEach(f=>{
      const r=new FileReader();r.onload=e=>onAdd({id:Math.random().toString(36).slice(2),url:e.target.result});r.readAsDataURL(f);
    });
  },[onAdd]);
  return <>{fotos.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:7}}>
    {fotos.map(f=><div key={f.id} className="fotothumb" onClick={()=>setLb(f.url)}>
      <img src={f.url} alt=""/><button className="fotodel" onClick={e=>{e.stopPropagation();onDel(f.id);}}>×</button>
    </div>)}
  </div>}
  <div className="fotodrop" onClick={()=>ref.current?.click()}>
     {fotos.length>0?`${fotos.length} foto(s) — agregar más`:"Agregar fotos de evidencia"}
  </div>
  <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>leer(e.target.files)}/>
  <Lightbox url={lb} onClose={()=>setLb(null)}/></>;
}
function ConceptoFotos({fotos,onAdd,onDel}){
  const ref=useRef();const[lb,setLb]=useState(null);
  const leer=useCallback(files=>{
    Array.from(files).filter(f=>f.type.startsWith("image/")).forEach(f=>{
      const r=new FileReader();r.onload=e=>onAdd({id:Math.random().toString(36).slice(2),url:e.target.result});r.readAsDataURL(f);
    });
  },[onAdd]);
  return <div>{fotos.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:5}}>
    {fotos.map(f=><div key={f.id} className="fotothumb" onClick={()=>setLb(f.url)}>
      <img src={f.url} alt=""/><button className="fotodel" onClick={e=>{e.stopPropagation();onDel(f.id);}}>×</button>
    </div>)}
  </div>}
  <div className="fotodrop" style={{fontSize:9,padding:"5px 8px"}} onClick={()=>ref.current?.click()}>
     {fotos.length>0?`${fotos.length} foto(s)`:"Agregar foto"}
  </div>
  <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>leer(e.target.files)}/>
  <Lightbox url={lb} onClose={()=>setLb(null)}/></div>;
}

// ── DATOS ──────────────────────────────────────────────────────────────────
const CATALOGO = {
  "A1.4": {
    nombre: "ANDADOR PEATONAL",
    imp_total: 33217646.21,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:598.51,pu:202.15,importe:120988.8,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:778.06,pu:39.38,importe:30640.0,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:11670.95,pu:36.01,importe:420270.91,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38.",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE), EN CAPAS NO MAYORES A 20 CM, COMPACTADO AL 90% DEL P.V.S.M.; INCLUYE: MATERIAL",unidad:"M3",cantidad:258.51,pu:1161.66,importe:300300.73,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-002",desc:"FIRME DE CONCRETO HIDRÁULICO F’C = 150 KG/CM², DE 16 CM DE ESPESOR, REFORZADO CON MALLA ELECTROSOLDADA 6-6/10-10; INCLUY",unidad:"M2",cantidad:6852.48,pu:1253.2,importe:8587527.94,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-003",desc:"CONSTRUCCIÓN DE DENTELLÓN PERIMETRAL DE 10 CM DE ANCHO POR 17 CM DE ALTURA, REFORZADO A BASE DE ARMEX 15 X 10 X 4, CON C",unidad:"M",cantidad:71.28,pu:562.63,importe:40104.27,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_10",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 10 X 10 DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. 1",unidad:"M2",cantidad:2810.37,pu:3652.58,importe:10265101.25,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_20",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 20 X 20  DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. ",unidad:"M2",cantidad:3160.18,pu:3100.09,importe:9796842.42,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41R",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE REAL TOPACIO REGULAR 10X10 PORFIDO DE 4CM DE ESPESOR, ASENTADO CON MORTERO CEMENTO AR",unidad:"M2",cantidad:881.93,pu:4069.11,importe:3588670.18,avance:0,fotos:[]},
      {clave:"0219-OAX-FCH-43",desc:"CONCRETO EN ESTRUCTURA DE 20CM DE ESPESOR, HECHO EN OBRA DE F´C= 250 KG/CM2 INCLUYE: ACARREOS, CIMBRADO Y DESCIMBRADO, C",unidad:"M3",cantidad:11.45,pu:5868.97,importe:67199.71,avance:0,fotos:[]},
    ],
  },
  "B1.10.1": {
    nombre: "MOBILIARIO URBANO",
    imp_total: 22148492.26,
    conceptos: [
      {clave:"0219-OAX-BCAN-135",desc:"SUMINISTRO Y FABRICACION DE BANCA DE CANTERA RUSTICA 135CM DE LONGITUD, 45CM DE ANCHO, 40CM DE ALTURA INCLUYE MARTELINAD",unidad:"PZA",cantidad:180.0,pu:38094.54,importe:6857017.2,avance:0,fotos:[]},
      {clave:"0219-OAX-APB-C1",desc:"SUMINISTRO, FABRICACIÓN Y COLOCACIÓN  DE APARCABICIS, CON DIMENSIONES DE 46 Cm DE ANCHO Y 75 CM DE ALTURA, FABRICADO EN ",unidad:"PZA",cantidad:50.0,pu:16553.08,importe:827654.0,avance:0,fotos:[]},
      {clave:"0219-OAX-BLRD-50",desc:"SUMINISTRO Y COLOCACIÓN DE BOLARDOS DE ACERO DE PLACA METALICA 5/8'' CON DIMENSIONES DE 46 CM DE DIAMETRO Y 0.50 M DE AL",unidad:"PZA",cantidad:598.0,pu:19562.34,importe:11698279.32,avance:0,fotos:[]},
      {clave:"0219-OAX-BMT-CT1",desc:"FABRICACION Y MONTAJE DE BASURERO METALICO DE 0.43M X 0.43M X 0.60M A BASE DE LAMINA NEGRA CALIBRE 11 SEGÚN DISEÑO DE PR",unidad:"PZA",cantidad:40.0,pu:24418.79,importe:976751.6,avance:0,fotos:[]},
      {clave:"0219-OAX-SEÑ-INF01",desc:"SUMINISTRO Y COLOCACIÓN DE SEÑALÉTICA INFORMATIVA, PREVENTIVA Y RESTRICTIVA, FABRICADA EN LÁMINA GALVANIZADA CALIBRE 18,",unidad:"PZA",cantidad:123.0,pu:10823.34,importe:1331270.82,avance:0,fotos:[]},
      {clave:"0219-OAX-SEÑ-INF02",desc:"SUMIISTRO, FABRICACION Y MONTAJE DE SEÑALETICA, TOTEM DE SEÑALAMIENTO MIXTO CON ESTRUCTURA DE ACERO ELECTROPINTADO, MEDI",unidad:"PZA",cantidad:9.0,pu:50835.48,importe:457519.32,avance:0,fotos:[]},
    ],
  },
  "B1.4": {
    nombre: "ANDADOR PEATONAL",
    imp_total: 17739848.09,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:945.47,pu:202.15,importe:191126.76,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38.",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE), EN CAPAS NO MAYORES A 20 CM, COMPACTADO AL 90% DEL P.V.S.M.; INCLUYE: MATERIAL",unidad:"M3",cantidad:180.25,pu:1161.66,importe:209389.22,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-002",desc:"FIRME DE CONCRETO HIDRÁULICO F’C = 150 KG/CM², DE 16 CM DE ESPESOR, REFORZADO CON MALLA ELECTROSOLDADA 6-6/10-10; INCLUY",unidad:"M2",cantidad:3604.92,pu:1253.2,importe:4517685.74,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-003.",desc:"CONSTRUCCIÓN DE DENTELLÓN PERIMETRAL DE 10 CM DE ANCHO POR 17 CM DE ALTURA, REFORZADO A BASE DE ARMEX 15 X 10 X 4, CON C",unidad:"ML",cantidad:145.12,pu:562.63,importe:81648.87,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_10",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 10 X 10 DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. 1",unidad:"M2",cantidad:768.24,pu:3652.58,importe:2806058.06,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_20",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 20 X 20  DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. ",unidad:"M2",cantidad:1674.11,pu:3100.09,importe:5189891.67,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41R",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE REAL TOPACIO REGULAR 10X10 PORFIDO DE 4CM DE ESPESOR, ASENTADO CON MORTERO CEMENTO AR",unidad:"M2",cantidad:1162.57,pu:4069.11,importe:4730625.21,avance:0,fotos:[]},
      {clave:"0219-OAX-PT-CP01",desc:"PINTURA DE TRAFICO PARA CIRCUITO DE PATINAJE DE 10CM DE ANCHO, APLICADO SOBRE RECINTO, INCLUYE SUMIISTRO DE MATERIAL, HE",unidad:"ML",cantidad:340.07,pu:39.47,importe:13422.56,avance:0,fotos:[]},
    ],
  },
  "A1.7.1": {
    nombre: "TERRACERIAS",
    imp_total: 11569121.13,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:424.28,pu:202.15,importe:85768.2,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:726.06,pu:39.38,importe:28592.24,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:10890.95,pu:36.01,importe:392183.11,avance:0,fotos:[]},
      {clave:"0219-OAX-AYRB-49",desc:"AFINE Y COMPACTACIÓN DE TERRENO NATURAL CON MATERIAL DE BANCO EN CAPAS NO MAYORES A 20 CMS POR MEDIOS MANUALES CON BAILA",unidad:"M2",cantidad:2121.41,pu:239.47,importe:508014.05,avance:0,fotos:[]},
      {clave:"0219-OAX-RBHD-01",desc:"RELLENO CON BASE HIDRAULICA: 40% ARENA, 30% GRAVA TMA 1', 20% GRAVA TMA 3/4', 10% MATERIAL PARA REVESTIMIENTO, COMPACTAD",unidad:"M3",cantidad:424.28,pu:5093.16,importe:2160925.92,avance:0,fotos:[]},
      {clave:"0219-OAX-GUC-50",desc:"GUARNICION DE 15 X 60 CMS DE ALTURA, DE UN CONCRETO F´C =250 KG/CM2 REFROZADO CON 4 VARILLA DEL NO 3 Y ESTRIBOS DEL NO 2",unidad:"ML",cantidad:894.57,pu:1412.22,importe:1263329.65,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-008",desc:"FIRME DE CONCRETO HIDRAULICO MR-42  DE 20CM DE ESPESOR, REFORZADO CON MALLA ELECTROLDADA 6-6 / 10-10, INCLUYE SILLETAS D",unidad:"M2",cantidad:2121.41,pu:1516.27,importe:3216630.34,avance:0,fotos:[]},
      {clave:"0219-OAX-PRN-41_20",desc:"SUMINISTRO Y COLOCACIÓN DE PISO DE RECINTO NEGRO 20 X 20  DE 4 CMS DE ESPESOR, ASENTADO CON MORTERO CEMENTO ARENA PROP. ",unidad:"M2",cantidad:1262.44,pu:3100.09,importe:3913677.62,avance:0,fotos:[]},
    ],
  },
  "B1.7B": {
    nombre: "SISTEMA DE INFILTRACIÓN Y BOMBEO PLUVIAL",
    imp_total: 7378421.15,
    conceptos: [
      {clave:"0219-OAX-PZO-ABS01",desc:"CONSTRUCCION Y PERFORACION DE POZO DE ABSORCION DE 100.00 MTS DE PROFUNDIDAD Y 18' Ø. INCLUYE: INSTALACION Y DESMANTELAM",unidad:"PZA",cantidad:1.0,pu:2565429.9,importe:2565429.9,avance:0,fotos:[]},
      {clave:"0219-OAX-PZO-EXT01",desc:"CONSTRUCCION Y PERFORACION DE POZO DE EXTRACCION DE 100 MTS DE PROFUNDIDAD Y 14' Ø. INCLUYE INSTALACION  Y DESMANTELAMIE",unidad:"PZA",cantidad:1.0,pu:3390475.76,importe:3390475.76,avance:0,fotos:[]},
      {clave:"0219-OAX-CBOM-C1",desc:"CONSTRUCCION DE CARCAMO DE BOMBEO DE 4.58M DE LARGO X 1.60M DE ANCHO X 1.70 M DE ALTO, A BASE DE MURO DE TABIQUE LIGERO ",unidad:"PZA",cantidad:1.0,pu:249882.82,importe:249882.82,avance:0,fotos:[]},
      {clave:"0219-OAX-EQ-PEXT-01",desc:"SUMINISTRO E INSTALACION DE EQUIPO ELECTROMECANICO PARA CARCAMO DE BOMBEO. INCLUYE: SUMINISTRO E INSTALACION DE TREN DE ",unidad:"PZA",cantidad:1.0,pu:1172632.67,importe:1172632.67,avance:0,fotos:[]},
    ],
  },
  "B1.7": {
    nombre: "ACCESO VEHICULAR",
    imp_total: 7311598.19,
    conceptos: [
      {clave:"0219-OAX-CBH-08",desc:"EXCAVACIÓN EN CAJA POR MEDIOS MECÁNICOS EN MATERIAL SECO TIPO B; INCLUYE: MAQUINARIA, MARTILLO HIDRÁULICO (EN CASO NECES",unidad:"M3",cantidad:866.5,pu:202.15,importe:175162.98,avance:0,fotos:[]},
      {clave:"0219-OAX-AYRB-49",desc:"AFINE Y COMPACTACIÓN DE TERRENO NATURAL CON MATERIAL DE BANCO EN CAPAS NO MAYORES A 20 CMS POR MEDIOS MANUALES CON BAILA",unidad:"M2",cantidad:2190.99,pu:239.47,importe:524676.38,avance:0,fotos:[]},
      {clave:"0219-OAX-GUC-50",desc:"GUARNICION DE 15 X 60 CMS DE ALTURA, DE UN CONCRETO F´C =250 KG/CM2 REFROZADO CON 4 VARILLA DEL NO 3 Y ESTRIBOS DEL NO 2",unidad:"ML",cantidad:749.0,pu:1412.22,importe:1057752.78,avance:0,fotos:[]},
      {clave:"0219-OAX-RBHD-01.",desc:"RELLENO CON BASE HIDRAULICA: 40% ARENA, 30% GRAVA TMA 1, 20% GRAVA TMA 3/4', 10% MATERIAL PARA REVESTIMIENTO, COMPACTADO",unidad:"M3",cantidad:438.21,pu:5093.16,importe:2231873.64,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-008",desc:"FIRME DE CONCRETO HIDRAULICO MR-42  DE 20CM DE ESPESOR, REFORZADO CON MALLA ELECTROLDADA 6-6 / 10-10, INCLUYE SILLETAS D",unidad:"M2",cantidad:2190.99,pu:1516.27,importe:3322132.41,avance:0,fotos:[]},
    ],
  },
  "B1.9.1": {
    nombre: "CISTERNA",
    imp_total: 6908046.86,
    conceptos: [
      {clave:"0219-OAX-TRAZ-03.",desc:"TRAZO Y NIVELACIÓN CON EQUIPO DE TOPOGRAFÍA, INCLUYE: CUADRILLA DE TOPOGRAFÍA, EQUIPO, HERRAMIENTA Y EQUIPO DE SEGURIDAD",unidad:"M2",cantidad:256.12,pu:23.99,importe:6144.32,avance:0,fotos:[]},
      {clave:"0219-OAX-EXCJ-26",desc:"EXCAVACIÓN POR MEDIOS MANUALES EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MAXIMA DE 1.00 METROS EN TERRENO NATURAL. INCLUYE; ",unidad:"M3",cantidad:1037.26,pu:246.09,importe:255259.31,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION.  PRIMER KILOMETRO, INCLUYE: EQUIPO HERRAMIENTA, AC",unidad:"M3",cantidad:1348.44,pu:39.38,importe:53101.57,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION. KILOMETRO SUBSECUENTE, ZONA URBANA INCLUYE: ACARRE",unidad:"M3//KM",cantidad:20226.57,pu:36.01,importe:728358.79,avance:0,fotos:[]},
      {clave:"OAX.ZARP-TN1",desc:"PERFILADO Y ZARPEO DE MUROS DEL ALUD EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MÁXIMA DE 5.00 METROS PARA CISTERNA DE MÓDULO",unidad:"M2",cantidad:313.2,pu:497.2,importe:155723.04,avance:0,fotos:[]},
      {clave:"0219-OAX-AYRB-49",desc:"AFINE Y COMPACTACIÓN DE TERRENO NATURAL CON MATERIAL DE BANCO EN CAPAS NO MAYORES A 20 CMS POR MEDIOS MANUALES CON BAILA",unidad:"M2",cantidad:154.0,pu:239.47,importe:36878.38,avance:0,fotos:[]},
      {clave:"0219-OAX-CAM-A01",desc:"SUMINISTRO Y COLOCACIÓN DE CAMA DE ARENA DE 10 CM DE ESPESOR INCLUYE: MATERIAL MANO DE OBRA, ACARREOS Y TODO LO NECESARI",unidad:"M2",cantidad:154.0,pu:231.4,importe:35635.6,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE) EN CAPAS NO MAYORES A 20 CMS COMPACTADO AL 90% DE SU PVSM. INCLUYE: MATERIAL, M",unidad:"M3",cantidad:706.93,pu:1161.66,importe:821212.3,avance:0,fotos:[]},
      {clave:"0219-OAX-AQUA-C01",desc:"SUMINISTRO, HABILITADO Y CONFORMADO DE CISTERNA PREFABRICADA WAVIN AQUACELL, CON UNA DIMENSIÓN DE 14.40M X 9.00M X 2.43M",unidad:"PZA",cantidad:1.0,pu:4815733.55,importe:4815733.55,avance:0,fotos:[]},
    ],
  },
  "B1.10.4": {
    nombre: "AREA SKATE PARK",
    imp_total: 4983613.51,
    conceptos: [
      {clave:"0219-OAX-TRAZ-03.",desc:"TRAZO Y NIVELACIÓN CON EQUIPO DE TOPOGRAFÍA, INCLUYE: CUADRILLA DE TOPOGRAFÍA, EQUIPO, HERRAMIENTA Y EQUIPO DE SEGURIDAD",unidad:"M2",cantidad:800.0,pu:23.99,importe:19192.0,avance:0,fotos:[]},
      {clave:"0219-OAX-EXCJ-26",desc:"EXCAVACIÓN POR MEDIOS MANUALES EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MAXIMA DE 1.00 METROS EN TERRENO NATURAL. INCLUYE; ",unidad:"M3",cantidad:360.0,pu:246.09,importe:88592.4,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION.  PRIMER KILOMETRO, INCLUYE: EQUIPO HERRAMIENTA, AC",unidad:"M3",cantidad:468.0,pu:39.38,importe:18429.84,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACION Y DEMOLICION. KILOMETRO SUBSECUENTE, ZONA URBANA INCLUYE: ACARRE",unidad:"M3//KM",cantidad:7020.0,pu:36.01,importe:252790.2,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE) EN CAPAS NO MAYORES A 20 CMS COMPACTADO AL 90% DE SU PVSM. INCLUYE: MATERIAL, M",unidad:"M3",cantidad:160.0,pu:1161.66,importe:185865.6,avance:0,fotos:[]},
      {clave:"0219-OAX-CIM-GRA01",desc:"SUMINISTRO Y TENDIDO DE CAMA DE FILTRO A BASE DE GRAVILLA 3/4', CRIBADO DE 10 CMS DE ESPESOR, GRADO DE ACOMODADO 8% DE S",unidad:"M3",cantidad:80.0,pu:2491.89,importe:199351.2,avance:0,fotos:[]},
      {clave:"0219-OAX-EST-C250",desc:"FIRME DE CONCRETO HIDRAULICO PREMEZCLADO F'C = 250KG/M2 DE 20CM DE ESPESOR, INCLUYE: SUMINISTRO, ARMADO Y COLOCACION DE ",unidad:"M2",cantidad:440.49,pu:1340.11,importe:590305.05,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-LOOP",desc:"CONSTRUCCIÓN DE MODULO #1 LOOP SANTI + QUATER PIPE (X2), EJE LONGITUDINAL DE 4.75M, EJE TRANSVERSAL DE 10.00 M, . INCLUY",unidad:"PZA",cantidad:1.0,pu:467437.93,importe:467437.93,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-SPEED",desc:"CONSTRUCCIÓN DE MODULO #2 SPEED BUMP / HIPPIE PUMP, DIAMETRO 4.20M, ALZADO DE 0.55M A PARTIR DE NPT. INCLUYE: EXCAVACION",unidad:"PZA",cantidad:1.0,pu:242403.37,importe:242403.37,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-DIAM",desc:"CONSTRUCCIÓN DE MODULO #3 DIAMON - BUMP TO BUMP, EJE LONGITUDINAL DE 5.48M Y EJE TRANSVERSAL DE 8.46M. INCLUYE: EXCAVACI",unidad:"PZA",cantidad:1.0,pu:432207.62,importe:432207.62,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-FBOX",desc:"CONSTRUCCIÓN DE MODULO #4 FUN BOX CRUZ FIALLO, EJE LONGITUDINAL DE 5.48M Y EJE TRANSVERSAL DE 8.00M. INCLUYE: EXCAVACION",unidad:"PZA",cantidad:1.0,pu:315762.69,importe:315762.69,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-PYRAM",desc:"CONSTRUCCIÓN DE MODULO #5 PLANTA 3 SIDE PYRAMID HIP, EJE LONGITUDINAL DE 5.04M Y EJE TRANSVERSAL DE 3.95M. INCLUYE: EXCA",unidad:"PZA",cantidad:1.0,pu:270597.64,importe:270597.64,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-BUMP",desc:"CONSTRUCCIÓN DE MODULO #6 BUMP TO BUMP TO DIAMOND, EJE LONGITUDINAL DE 4.70M Y EJE TRANSVERSAL DE 8.105M. INCLUYE: EXCAV",unidad:"PZA",cantidad:1.0,pu:315193.31,importe:315193.31,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-MRAMP",desc:"CONSTRUCCIÓN DE MODULO #7 MINI RAMP, EJE LONGITUDINAL DE 19.06M Y EJE TRANSVERSAL DE3.40M. INCLUYE: EXCAVACION DE TERREN",unidad:"PZA",cantidad:2.0,pu:462481.25,importe:924962.5,avance:0,fotos:[]},
      {clave:"0219-OAX-SKT-BMX",desc:"CONSTRUCCIÓN DE MODULO #8 BOLW BMX > SKATE TIPO CACAHUATE, EJE LONGITUDINAL DE 13.10M, EJE TRANSVERSAL DE 8.25 M, . INCL",unidad:"PZA",cantidad:1.0,pu:660522.16,importe:660522.16,avance:0,fotos:[]},
    ],
  },
  "A1.3": {
    nombre: "DRENAJE PLUVIAL",
    imp_total: 4644580.24,
    conceptos: [
      {clave:"0219-OAX-EX25-24",desc:"EXCAVACIÓN POR MEDIOS MECÁNICOS EN TERRENO TIPO “B”, A UNA PROFUNDIDAD MÁXIMA DE 2.50 METROS, PARA DRENAJE PLUVIAL; INCL",unidad:"M3",cantidad:1289.31,pu:220.31,importe:284047.89,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:1676.12,pu:39.38,importe:66005.61,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:25141.69,pu:36.01,importe:905352.26,avance:0,fotos:[]},
      {clave:"0219-OAX-AFT-35",desc:"AFINE DE FONDO DE CEPA PARA LA INSTALACIÓN DE TUBERÍA PLUVIAL, POR MEDIOS MANUALES CON BAILARINA; INCLUYE: MANO DE OBRA,",unidad:"M2",cantidad:573.05,pu:105.17,importe:60267.67,avance:0,fotos:[]},
      {clave:"0219-OAX-CA5-36",desc:"SUMINISTRO Y COLOCACIÓN DE CAMA DE ARENA DE 10 CM DE ESPESOR PARA ASENTAR TUBERÍA PEAD CORRUGADA DE 45 CM DE DIÁMETRO; I",unidad:"M2",cantidad:573.05,pu:231.4,importe:132603.77,avance:0,fotos:[]},
      {clave:"0219-OAX-TPDR-31",desc:"TRABAJOS DE PERFORACIÓN DE TUBERÍA DE DRENAJE DE PEAD CORRUGADO DE 18' DE DIÁMETRO, CON TALADRO Y BROCA DE 1/2', A MEDIO",unidad:"M",cantidad:115.62,pu:168.87,importe:19524.75,avance:0,fotos:[]},
      {clave:"0219-OAX-TP45-34",desc:"SUMINISTRO E INSTALACIÓN DE TUBERÍA DE PEAD CORRUGADO DE 18' DE DIÁMETRO INTERIOR PARA DRENAJE PLUVIAL, HASTA 3 M DE PRO",unidad:"M",cantidad:764.04,pu:2322.41,importe:1774414.14,avance:0,fotos:[]},
      {clave:"0219-OAX-ACT-37",desc:"ACOSTILLADO DE TUBERÍA CON MATERIAL DE BANCO (GRAVA 3/4'), CRIBADO, LIMPIO Y LIBRE DE FINOS, COLOCADO EN CAPAS NO MAYORE",unidad:"M3",cantidad:136.61,pu:1571.4,importe:214668.95,avance:0,fotos:[]},
      {clave:"0219-OAX-GTX-H01",desc:"SUMINISTRO Y COLOCACIÓN DE GEOTEXTIL NO TEJIDO DE POLIPROPILENO, PUNZONADO MECÁNICAMENTE, CON UN GRAMAJE MÍNIMO DE 200 G",unidad:"PZA",cantidad:16.0,pu:11231.95,importe:179711.2,avance:0,fotos:[]},
      {clave:"0219-OAX-RMT-38.",desc:"RELLENO CON MATERIAL DE BANCO (TEPETATE), EN CAPAS NO MAYORES A 20 CM, COMPACTADO AL 90% DEL P.V.S.M.; INCLUYE: MATERIAL",unidad:"M3",cantidad:867.71,pu:1161.66,importe:1007984.0,avance:0,fotos:[]},
    ],
  },
  "A1.5": {
    nombre: "JARDINERIA",
    imp_total: 4248745.89,
    conceptos: [
      {clave:"0219-OAX-EXCJ-26",desc:"EXCAVACIÓN POR MEDIOS MANUALES EN TERRENO TIPO 'B' A UNA PROFUNDIDAD MAXIMA DE 1.00 METROS EN TERRENO NATURAL. INCLUYE; ",unidad:"M3",cantidad:416.68,pu:246.09,importe:102540.78,avance:0,fotos:[]},
      {clave:"0219-OAX-ACA1-10..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, PRIMER KILÓMETRO; INCLUYE: EQUIPO, HERRAMIENTA, CARGA, ACARREO ",unidad:"M3",cantidad:541.68,pu:39.38,importe:21331.36,avance:0,fotos:[]},
      {clave:"0219-OAX-ACAS-11..",desc:"ACARREO EN CAMIÓN DE MATERIAL PRODUCTO DE LA EXCAVACIÓN, KILÓMETRO SUBSECUENTE, EN ZONA URBANA; INCLUYE: CARGA, ACARREO ",unidad:"M3//KM",cantidad:8125.26,pu:36.01,importe:292590.61,avance:0,fotos:[]},
      {clave:"0219-OAX-CIM-J12X30",desc:"CONSTRUCCIÓN DE CADENA DE CONCRETO DE 0.15 X 0.30 M, CON CONCRETO PREMEZCLADO BOMBEABLE F’C = 250 KG/CM²; INCLUYE: SUMIN",unidad:"ML",cantidad:1090.56,pu:1010.73,importe:1102261.71,avance:0,fotos:[]},
      {clave:"0219-OAX-SAR-44",desc:"SUMINISTRO Y SIEMBRA DE ÁRBOL (PALO MULATO, PRIMAVERA, CEIBA, POCHOTE GRIS, FLOR DE MAYO, GUIEXUUBA, COQUITO, GUAMÚCHIL,",unidad:"PZA",cantidad:71.0,pu:19095.84,importe:1355804.64,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-005",desc:"SUMINISTRO Y COLOCACIÓN DE CAPA DE TEZONTLE DE 0.15 M DE ESPESOR, EN JARDINERAS TRIANGULARES DE 4.24 X 4.24 M Y 6.00 M D",unidad:"M3",cantidad:95.85,pu:4033.16,importe:386578.39,avance:0,fotos:[]},
      {clave:"0219-OAX-ADC-006",desc:"SUMINISTRO, FABRICACIÓN Y COLOCACIÓN DE MARCO METÁLICO TRIANGULAR A BASE DE ÁNGULO DE 4' X 1/4', CON LAS SIGUIENTES DIME",unidad:"PZA",cantidad:71.0,pu:13910.4,importe:987638.4,avance:0,fotos:[]},
    ],
  },
};

const NOMINA_S18 = [
  {nombre:'EDUARDO BOTELLO VASQUEZ',categoria:'DIRECTOR DE OBRA',tipo:'I',salarioSemanal:7466.67,salarioDiario:1244.445,diasTrabajados:6.0,horasExtra:0,importeDias:7466.67,importeHE:0,total:8666.67,semana:18},
  {nombre:'JHOAN SMITH MONTIEL CORTES',categoria:'GERENTE DE HSE',tipo:'I',salarioSemanal:6500.0,salarioDiario:1083.3333,diasTrabajados:6.0,horasExtra:0,importeDias:6500.0,importeHE:0,total:8000.0,semana:18},
  {nombre:'PABLO CASTILLO VILLALOBOS',categoria:'CONTROL DE OBRA',tipo:'I',salarioSemanal:8600.0,salarioDiario:1433.3333,diasTrabajados:6.0,horasExtra:0,importeDias:8600.0,importeHE:0,total:9800.0,semana:18},
  {nombre:'JUAN EDGAR SUAREZ PRIETO',categoria:'SUPERVISOR DE OBRA',tipo:'I',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:0,importeDias:5000.0,importeHE:0,total:5000.0,semana:18},
  {nombre:'JOSE EMMANUEL ALEGRIA CUETO',categoria:'LOGISTICA',tipo:'I',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:10.0,importeDias:5000.0,importeHE:1200.0,total:7400.0,semana:18},
  {nombre:'ERICK GUTIERREZ JIMENEZ',categoria:'AUX. ADMINISTRATIVO',tipo:'I',salarioSemanal:5500.0,salarioDiario:916.6667,diasTrabajados:6.0,horasExtra:0,importeDias:5500.0,importeHE:0,total:5500.0,semana:18},
  {nombre:'VIDAL MORALES HERNANDEZ',categoria:'VELADOR',tipo:'I',salarioSemanal:3500.0,salarioDiario:583.3333,diasTrabajados:6.0,horasExtra:0,importeDias:3500.0,importeHE:0,total:3500.0,semana:18},
  {nombre:'MATEO GONZALEZ PEREZ',categoria:'VELADOR',tipo:'I',salarioSemanal:3500.0,salarioDiario:583.3333,diasTrabajados:5.0,horasExtra:0,importeDias:2916.67,importeHE:0,total:2916.67,semana:18},
  {nombre:'MIGUEL AGUILAR EVIA',categoria:'BODEGUERO',tipo:'I',salarioSemanal:3300.0,salarioDiario:550.0,diasTrabajados:6.0,horasExtra:24.0,importeDias:3300.0,importeHE:2880.0,total:7380.0,semana:18},
  {nombre:'JOSE ANTONIO DE JESUS MARIN',categoria:'OFICIAL FIERRERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:24.0,importeDias:4000.0,importeHE:3600.0,total:9000.0,semana:18},
  {nombre:'ALEJANDRO GUZMAN MENDEZ',categoria:'OFICIAL CARPINTERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'JUAN MIGUEL MORALES GARCIA',categoria:'CABO',tipo:'D',salarioSemanal:6000.0,salarioDiario:1000.0,diasTrabajados:6.0,horasExtra:28.0,importeDias:6000.0,importeHE:4200.0,total:11400.0,semana:18},
  {nombre:'RODOLFO AQUINO HERNANDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:20.0,importeDias:4000.0,importeHE:3000.0,total:8400.0,semana:18},
  {nombre:'JUAN JOSE GARCIA TELLEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'BERENICE CARRILLO RAMIREZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:12.0,importeDias:3000.0,importeHE:1440.0,total:4440.0,semana:18},
  {nombre:'DAVID VAZQUEZ SANTOS',categoria:'TOPOGRAFO',tipo:'D',salarioSemanal:5300.0,salarioDiario:883.3333,diasTrabajados:6.0,horasExtra:16.0,importeDias:5300.0,importeHE:2400.0,total:8900.0,semana:18},
  {nombre:'MIGUEL ANGEL MENDEZ MATIAS',categoria:'CHOFER',tipo:'D',salarioSemanal:3500.0,salarioDiario:583.3333,diasTrabajados:6.0,horasExtra:20.0,importeDias:3500.0,importeHE:2400.0,total:5900.0,semana:18},
  {nombre:'MELQUIADES CHAPAN MEMECHI',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:24.0,importeDias:4000.0,importeHE:3600.0,total:9000.0,semana:18},
  {nombre:'RICARDO JUAREZ SANCHEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:20.0,importeDias:4000.0,importeHE:3000.0,total:8400.0,semana:18},
  {nombre:'MARCOS MANUEL SANCHEZ PEREZ',categoria:'OPERADOR RETRO EXCAVADORA',tipo:'D',salarioSemanal:6500.0,salarioDiario:1083.3333,diasTrabajados:6.0,horasExtra:18.0,importeDias:6500.0,importeHE:2700.0,total:10600.0,semana:18},
  {nombre:'HERMELINDO NUÑEZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:19.0,importeDias:4000.0,importeHE:2850.0,total:8250.0,semana:18},
  {nombre:'ISRAEL NUÑEZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:19.0,importeDias:4000.0,importeHE:2850.0,total:8250.0,semana:18},
  {nombre:'ALFREDO MACUIXTLE DE JESUS',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'MARICELA HERNANDEZ FRANCO',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:16.0,importeDias:3000.0,importeHE:1920.0,total:4920.0,semana:18},
  {nombre:'SAMUEL MARTINEZ REYES',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:24.0,importeDias:4000.0,importeHE:3600.0,total:9000.0,semana:18},
  {nombre:'GUSTAVO HERNANDEZ RODRIGUEZ',categoria:'PAILERO',tipo:'D',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:5.0,importeDias:5000.0,importeHE:600.0,total:6800.0,semana:18},
  {nombre:'JESUS ABEL GUZMAN DE LA CRUZ',categoria:'SOLDADOR',tipo:'D',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:4.0,horasExtra:10.0,importeDias:3333.33,importeHE:1200.0,total:5333.33,semana:18},
  {nombre:'ALEJANDRO HERNANDEZ GERARDO',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:5.0,importeDias:4000.0,importeHE:750.0,total:6150.0,semana:18},
  {nombre:'NOHEMY GABRIELA RODRIGUEZ VELASQUEZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:11.0,importeDias:3000.0,importeHE:1320.0,total:4320.0,semana:18},
  {nombre:'JONATAN CHAPAN CHIBAMBA',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:22.0,importeDias:4000.0,importeHE:3300.0,total:8700.0,semana:18},
  {nombre:'ROSENDO GUZMAN MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'JORGE GUTIERREZ JAIMES',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:5.0,horasExtra:0,importeDias:3333.33,importeHE:0,total:4500.33,semana:18},
  {nombre:'SAMUEL HERNANDEZ MEDINA',categoria:'CADENERO',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:14.0,importeDias:3000.0,importeHE:1680.0,total:4680.0,semana:18},
  {nombre:'SEVERO RAMIREZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:2.0,importeDias:3000.0,importeHE:240.0,total:3240.0,semana:18},
  {nombre:'HECTOR JIMENEZ HERNANDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:11.0,importeDias:4000.0,importeHE:1650.0,total:5650.0,semana:18},
  {nombre:'JOSE OSVALDO GALLARDO MARTINEZ',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:20.0,importeDias:3000.0,importeHE:2400.0,total:5400.0,semana:18},
  {nombre:'ALEJANDRO VIDAL SANTIAGO',categoria:'AYUDANTE GENERAL',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:5.0,horasExtra:2.0,importeDias:2500.0,importeHE:240.0,total:2740.0,semana:18},
  {nombre:'JUAN GALINDO MARTINEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'VICTOR VILORIA RAMIREZ',categoria:'OFICIAL FIERRERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:7450.0,semana:18},
  {nombre:'ROSENDO JUAN BRIGADA',categoria:'OFICIAL CARPINTERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'BENIGNO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'DAVID BAUTISTA MARTINEZ',categoria:'OFICIAL CARPINTERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:3.0,horasExtra:17.0,importeDias:2000.0,importeHE:2550.0,total:4550.0,semana:18},
  {nombre:'MIGUEL ANGEL VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'MANUEL GUZMAN MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'RICARDO JULIAN GOMEZ GOMEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'JHONATAN DE JESUS  MENDOZA ROMAN',categoria:'ARMADOR',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:15.0,importeDias:4000.0,importeHE:1800.0,total:7000.0,semana:18},
  {nombre:'SILVANO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'MIGUEL ANGEL GOMEZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'DAIRON CANO NUÑEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'DANIEL GOMEZ CRUZ',categoria:'OPERADOR RETRO EXCAVADORA',tipo:'D',salarioSemanal:5000.0,salarioDiario:833.3333,diasTrabajados:6.0,horasExtra:19.0,importeDias:5000.0,importeHE:2280.0,total:8480.0,semana:18},
  {nombre:'ARMANDO GUZMAN BAUTISTA',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'DANIEL GUZMAN BAUTISTA',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'JUAN PABLO ROSARIO SANCHEZ',categoria:'OFICIAL ALBANIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:15.0,importeDias:4000.0,importeHE:2250.0,total:7650.0,semana:18},
  {nombre:'EPIFANIO VELAZQUEZ GARCIA',categoria:'OFICIAL ALBANIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:0,horasExtra:0,importeDias:0,importeHE:0,total:0,semana:18},
  {nombre:'ANGEL LIBRADO NUÑEZ MENDEZ',categoria:'OFICIAL FIERRERO',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'FIDENCIO BELEN RUIZ',categoria:'OFICIAL ALBANIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:1.0,horasExtra:0,importeDias:666.67,importeHE:0,total:899.67,semana:18},
  {nombre:'DANIEL FABIAN BERNANDO CANSECO',categoria:'AYUDANTE',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:6.0,horasExtra:5.0,importeDias:3000.0,importeHE:600.0,total:3600.0,semana:18},
  {nombre:'ANTONIO QUIROZ MORALES',categoria:'AYUDANTE',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:3.0,horasExtra:0,importeDias:1500.0,importeHE:0,total:1500.0,semana:18},
  {nombre:'ORLANDO CANO NUÑEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'BRAULIO CANO NUÑEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'NEREO SANCHEZ SAINOS',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:25.0,importeDias:4000.0,importeHE:3750.0,total:9150.0,semana:18},
  {nombre:'LEOBARDO JUAREZ MENDEZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:18.0,importeDias:4000.0,importeHE:2700.0,total:8100.0,semana:18},
  {nombre:'FRANCISCO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'NARCISO VAZQUEZ JUAREZ',categoria:'OFICIAL ALBAÑIL',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:6.0,horasExtra:23.0,importeDias:4000.0,importeHE:3450.0,total:8850.0,semana:18},
  {nombre:'FREDIBETH VELAZQUEZ ANTONIO',categoria:'ARMADOR',tipo:'D',salarioSemanal:4000.0,salarioDiario:666.6667,diasTrabajados:3.0,horasExtra:0,importeDias:2000.0,importeHE:0,total:2000.0,semana:18},
  {nombre:'MIGUEL ANGEL GASPAR AGUILAR',categoria:'AYUDANTE',tipo:'D',salarioSemanal:3000.0,salarioDiario:500.0,diasTrabajados:2.0,horasExtra:0,importeDias:1000.0,importeHE:0,total:1000.0,semana:18},
];

const _OBRAS_BASE = [
  {id:"OAX01",nombre:"Oaxaca Parque Lineal",contrato:"IE-SIC/SSOP/UL-X010-2026",
   cliente:"Gob. Estado de Oaxaca",superintendente:"Ing. Eduardo Botello Vázquez",
   residente:"Ing. Ana Martínez",admin:"L.C. Pablo Castillo Villalobos",
   presupuesto:163348337,gastoGP:29330201,ultimaAct:"27 mayo 2026",
   estado:"activa",pctAnticipo:10,pctFondoGar:5,pctRetencion:0,
   inicio:"2026-05-01",fin:"2026-08-28"},
  {id:"SCT01",nombre:"Libramiento Norte Tramo 2",contrato:"SCT-JAL-2025-047",
   cliente:"SCT Jalisco",superintendente:"Por asignar",residente:"Ing. Luis Campos",
   admin:"C.P. Sandra Ruiz",presupuesto:48500000,gastoGP:7230450,
   ultimaAct:"25 mayo 2026",estado:"activa",pctAnticipo:10,pctFondoGar:5,pctRetencion:0,
   inicio:"2025-01-15",fin:"2025-10-30"},
  {id:"MUN01",nombre:"Planta Tratadora Agua Centro",contrato:"SAPAZA-2025-012",
   cliente:"SAPAZA",superintendente:"Ing. Roberto Díaz",residente:"Ing. Carmen Vega",
   admin:"L.C. Pablo Torres",presupuesto:32000000,gastoGP:30100000,
   ultimaAct:"20 mayo 2026",estado:"terminada",pctAnticipo:10,pctFondoGar:5,pctRetencion:0,
   inicio:"2024-09-01",fin:"2025-06-30"},
];

function loadObras() {
  // Carga inicial desde _OBRAS_BASE — filtrar obras eliminadas guardadas en localStorage
  // La key de eliminados depende del usuario — se evalúa en tiempo de ejecución
  // Por ahora filtramos con todas las keys campo_eliminados_*
  const _todasKeys=Object.keys(localStorage).filter(k=>k.startsWith('campo_eliminados_'));
  const eliminados=[..._todasKeys.flatMap(k=>JSON.parse(localStorage.getItem(k)||'[]'))];
  return _OBRAS_BASE.filter(o=>!eliminados.includes(o.id)).map(o=>({...o}));
}

const SUBS_INIT = [
  {sec:"A1.4",   sub:"Andador Peatonal",             imp:33217646,n:10,a:0,fotos:{}},
  {sec:"B1.10.1",sub:"Mobiliario Urbano",             imp:22148492,n:6, a:0,fotos:{}},
  {sec:"B1.4",   sub:"Andador Peatonal (Calle Const.)",imp:17739848,n:8,a:0,fotos:{}},
  {sec:"A1.7.1", sub:"Terracerias",                   imp:11569121,n:8, a:0,fotos:{}},
  {sec:"B1.7B",  sub:"Sistema Infiltración y Bombeo", imp:7378421, n:4, a:0,fotos:{}},
  {sec:"B1.7",   sub:"Acceso Vehicular",              imp:7311598, n:5, a:0,fotos:{}},
  {sec:"B1.9.1", sub:"Cisterna",                      imp:6752324, n:8, a:0,fotos:{}},
  {sec:"B1.10.4",sub:"Área Skate Park",               imp:4983614, n:15,a:0,fotos:{}},
  {sec:"A1.3",   sub:"Drenaje Pluvial",               imp:4644580, n:10,a:0,fotos:{}},
  {sec:"A1.5",   sub:"Jardinería",                    imp:4248746, n:7, a:0,fotos:{}},
];

const RUBROS_GP=[
  {id:"mat",label:"Materiales",         monto:13203452,color:C.blue},
  {id:"sue",label:"Sueldos y salarios", monto:11677695,color:C.green},
  {id:"ind",label:"Indirectos",         monto:3547181, color:C.purple},
  {id:"sub",label:"Subcontratos",       monto:249500,  color:C.orange},
  {id:"maq",label:"Renta y mant. maq.", monto:652372,  color:C.yellow},
];
const PERIODOS=[
  {k:"2025",l:"2025",  a:19087948},{k:"Ene",l:"Ene 26",a:21262688},
  {k:"Feb", l:"Feb 26",a:23822336},{k:"Mar",l:"Mar 26",a:26589100},
  {k:"S14", l:"Sem 14",a:26665633},{k:"S15",l:"Sem 15",a:27062468},
  {k:"S16", l:"Sem 16",a:28277453},{k:"S17",l:"Sem 17",a:29330201},
];
const CPTS=["Anticipo","En almacén","En tránsito","En fabricación"];
const CT_COL={"Anticipo":C.yellow,"En almacén":C.green,"En tránsito":C.blue,"En fabricación":C.purple};
const EST_COL={Pagada:C.green,Facturada:C.purple,Aprobada:C.blue,"En proceso":C.yellow};

// ── PANTALLA LOGIN ─────────────────────────────────────────────────────────
function Login({onLogin}){
  const[correo,setCorreo]=useState("");
  const[pass,setPass]=useState("");
  const[error,setError]=useState("");
  const[loading,setLoading]=useState(false);

  async function handleLogin(e){
    e.preventDefault();
    setLoading(true); setError("");
    try {
      // Autenticar con Firebase Auth
      const cred = await signInWithEmailAndPassword(fbAuth, correo.trim(), pass);
      const email = cred.user.email.toLowerCase();
      // Buscar perfil en Firestore (para roles dinámicos)
      let perfil = await fsGet(`usuarios/${email.replace('@','_').replace('.','_')}`);
      if (!perfil) {
        // Fallback a defaults hardcodeados
        perfil = ROLES_DEFAULT[email] || { rol:"administrador_obra", nombre:email };
      }
      onLogin({ correo:email, nombre:perfil.nombre, rol:perfil.rol, uid:cred.user.uid });
    } catch(e) {
      const msgs = {
        'auth/invalid-credential':'Correo o contraseña incorrectos',
        'auth/user-not-found':'Usuario no encontrado',
        'auth/wrong-password':'Contraseña incorrecta',
        'auth/too-many-requests':'Demasiados intentos. Espera unos minutos.',
        'auth/network-request-failed':'Error de conexión. Verifica tu internet.',
      };
      setError(msgs[e.code] || `Error: ${e.message}`);
      setLoading(false);
    }
  }

  return <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",
    alignItems:"center",justifyContent:"center",padding:24}}>
    <div style={{width:"100%",maxWidth:380}}>
      {/* Logo */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:32,gap:12}}>
        <EmblemaFOSMON size={48} dark={false}/>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"0.14em",color:C.caliza}}>CAMPO</div>
          <div style={{fontSize:9,color:C.textMut,letterSpacing:"0.08em",marginTop:2}}>FOSMON CONSTRUCCIONES</div>
        </div>
      </div>
      {/* Form */}
      <form onSubmit={handleLogin} style={{display:"flex",flexDirection:"column",gap:12}}>
        <div>
          <div style={{fontSize:10,color:C.textMut,marginBottom:5,letterSpacing:"0.04em"}}>CORREO CORPORATIVO</div>
          <input type="email" value={correo} onChange={e=>setCorreo(e.target.value)}
            placeholder="usuario@fosmon.com.mx"
            style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:8,
              padding:"12px 14px",color:C.textPri,fontSize:13,width:"100%",outline:"none"}}/>
        </div>
        <div>
          <div style={{fontSize:10,color:C.textMut,marginBottom:5,letterSpacing:"0.04em"}}>CONTRASEÑA</div>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
            placeholder="••••••••"
            style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:8,
              padding:"12px 14px",color:C.textPri,fontSize:13,width:"100%",outline:"none"}}/>
        </div>
        {error&&<div style={{background:"rgba(220,38,38,0.12)",border:"0.5px solid rgba(220,38,38,0.3)",
          borderRadius:7,padding:"9px 12px",fontSize:12,color:C.red}}>{error}</div>}
        <button type="submit" disabled={loading||!correo||!pass}
          style={{background:(!correo||!pass||loading)?"rgba(255,254,249,0.15)":C.caliza,
            border:"none",borderRadius:8,padding:13,color:(!correo||!pass||loading)?C.textMut:C.bg,
            fontSize:13,fontWeight:700,cursor:(!correo||!pass||loading)?"not-allowed":"pointer",
            letterSpacing:"0.04em",marginTop:4,transition:"all .2s"}}>
          {loading?"Verificando...":"Entrar a CAMPO"}
        </button>
      </form>
      <div style={{textAlign:"center",marginTop:20,fontSize:10,color:C.textMut}}>
        Control de Avance, Maquinaria, Personal y Obra
      </div>
    </div>
  </div>;
}

// ── PANTALLA OBRAS ─────────────────────────────────────────────────────────
// Modal para nueva obra

// ── GP CONSTRUCT — GOOGLE SHEETS ──────────────────────────────────────────
const GP_SHEET_ID = "1UaRI7ysMttXvET9I6hXPJAqadUYRd0Y0Qiwy8uRi82c";
const GP_SHEET_CSV = `https://docs.google.com/spreadsheets/d/${GP_SHEET_ID}/export?format=csv`;

// Parser del CSV de GP Construct
// Estructura: Obra (4 dígitos) > Rubro (3 dígitos) > Proveedor
function parsearGPConstruct(csvText) {
  const lines = csvText.split('\n').map(l => l.split(',').map(c => c.replace(/^"|"$/g,'').trim()));
  
  // Detectar columnas de semanas (fila 9 aprox - buscar números de 2 dígitos)
  let headerRow = -1;
  let colMap = {};
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const hasSemanas = lines[i].some(c => /^[1-5][0-9]$/.test(c));
    if (hasSemanas) {
      headerRow = i;
      lines[i].forEach((c, ci) => {
        if (/^[1-5][0-9]$/.test(c)) colMap[`S${c}`] = ci;
        if (/^2024$/.test(c)) colMap['2024'] = ci;
        if (/^2025$/.test(c)) colMap['2025'] = ci;
      });
      break;
    }
  }

  const obras = {};
  let curObra = null, curRubro = null;

  for (let i = (headerRow >= 0 ? headerRow + 1 : 10); i < lines.length; i++) {
    const row = lines[i];
    const b = row[1] || '';
    if (!b.trim()) continue;

    // Obra: empieza con 4 dígitos
    if (/^\d{4}\s/.test(b)) {
      curObra = b.trim();
      curRubro = null;
      if (!obras[curObra]) obras[curObra] = { rubros: {}, semanas: {} };
      Object.entries(colMap).forEach(([k, ci]) => {
        const v = parseFloat((row[ci] || '').replace(/[$,]/g, ''));
        if (!isNaN(v) && v !== 0) obras[curObra].semanas[k] = Math.abs(v);
      });
    }
    // Rubro: empieza con 3 dígitos
    else if (/^\d{3}\s/.test(b) && curObra) {
      curRubro = b.slice(0, 3);
      if (!obras[curObra].rubros[curRubro]) {
        obras[curObra].rubros[curRubro] = { nombre: b.trim(), semanas: {} };
      }
      Object.entries(colMap).forEach(([k, ci]) => {
        const v = parseFloat((row[ci] || '').replace(/[$,]/g, ''));
        if (!isNaN(v) && v !== 0) obras[curObra].rubros[curRubro].semanas[k] = Math.abs(v);
      });
    }
  }

  // Convertir a array con semanas disponibles
  const semanasDisponibles = Object.keys(colMap).filter(k => k.startsWith('S')).sort();
  const ultimaSemana = semanasDisponibles[semanasDisponibles.length - 1] || '';

  return {
    obras,
    semanasDisponibles,
    ultimaSemana,
    totalObras: Object.keys(obras).length,
  };
}

// Hook para cargar datos de GP Construct
function useGPConstruct() {
  const [gpData, setGpData] = useState(null);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState('');
  const [gpUltActualiz, setGpUltActualiz] = useState('');

  const cargarGP = useCallback(async () => {
    setGpLoading(true); setGpError('');
    try {
      const resp = await fetch(`https://corsproxy.io/?${encodeURIComponent(GP_SHEET_CSV)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const parsed = parsearGPConstruct(text);
      setGpData(parsed);
      setGpUltActualiz(new Date().toLocaleString('es-MX'));
      // Guardar en Firestore para acceso offline
      await fsSet('global/gp_construct', {
        data: parsed,
        ultimaActualizacion: new Date().toISOString()
      });
    } catch(e) {
      // Si falla el fetch, cargar desde Firestore
      const cached = await fsGet('global/gp_construct');
      if (cached) {
        setGpData(cached.data);
        setGpUltActualiz(`Cache: ${new Date(cached.ultimaActualizacion).toLocaleString('es-MX')}`);
      } else {
        setGpError('No se pudo cargar GP Construct: ' + e.message);
      }
    }
    setGpLoading(false);
  }, []);

  useEffect(() => { cargarGP(); }, []);

  return { gpData, gpLoading, gpError, gpUltActualiz, cargarGP };
}

// Catálogo de obras de GP Construct disponibles para activar en CAMPO
const GP_OBRAS_CATALOGO = [
  {id:"0001",nombre:"Oficina Central",          gastoGP:4759697},
  {id:"0002",nombre:"Taller",                    gastoGP:4050383},
  {id:"0013",nombre:"Transporte FOSMON",         gastoGP:1035239},
  {id:"0036",nombre:"Compras FOSMON",            gastoGP:22796},
  {id:"0037",nombre:"Licitaciones FOSMON",       gastoGP:1415674},
  {id:"0088",nombre:"PEMEX Mina Barda 2",        gastoGP:2001291},
  {id:"0094",nombre:"Linde San Luis Potosí",     gastoGP:5607628},
  {id:"0096",nombre:"FOSMON Nave Ind. Calzadas", gastoGP:3972951},
  {id:"0097",nombre:"PEMEX Mina Torre 100",      gastoGP:291441},
  {id:"0099",nombre:"Promotora Oaxaca Estadio",  gastoGP:554661},
  {id:"0100",nombre:"TAMSA Ver FAT 3",           gastoGP:770898},
  {id:"0102",nombre:"PEMEX Mina Rep. Barda",     gastoGP:16205},
  {id:"0104",nombre:"SIOP Coatza Bacheo",        gastoGP:0},
  {id:"0105",nombre:"TAMSA Ver CONALEP",         gastoGP:261611},
  {id:"0106",nombre:"FOSMON Río Calzadas",       gastoGP:1212071},
  {id:"0107",nombre:"FOSMON Bellavista",         gastoGP:321386},
  {id:"0109",nombre:"Centro de Convenciones",    gastoGP:6855115},
  {id:"0110",nombre:"SIOP Nanchital Rehab.",     gastoGP:129312},
  {id:"0111",nombre:"TAMSA Ver Cribado Mat.",    gastoGP:2353875},
  {id:"0112",nombre:"SIOP Coatza Malecón",       gastoGP:4004156},
  {id:"0114",nombre:"Oaxaca Parque Lineal",      gastoGP:10242253},
  {id:"0115",nombre:"TAMSA Veracruz Comedor",    gastoGP:4154156},
  {id:"0117",nombre:"SIOP Coatza Rem. Caseta",   gastoGP:1529870},
  {id:"0119",nombre:"SIOP Coatza Entronque",     gastoGP:572170},
  {id:"0120",nombre:"TAMSA Ver Montaje Estr.",   gastoGP:155244},
  {id:"0121",nombre:"SIOP Coatza Rehab. Av. Univ.", gastoGP:15006393},
  {id:"0122",nombre:"Ayto. Coatza Mantto",       gastoGP:129250},
  {id:"0123",nombre:"Ayto. Coatza Edificios",    gastoGP:886700},
  {id:"0124",nombre:"SIOP Coatza Rehab. Puente", gastoGP:1770125},
];

function ModalNuevaObra({onSave,onClose,gpData}){
  const[paso,setPaso]=useState("seleccionar"); // seleccionar | completar
  const[gpSel,setGpSel]=useState(null);
  const[busqueda,setBusqueda]=useState("");
  const[form,setForm]=useState({
    id:"",nombre:"",contrato:"",cliente:"",superintendente:"",
    residente:"",admin:"",presupuesto:"",gastoGP:0,
    ultimaAct:new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"}),
    estado:"activa",pctAnticipo:10,pctFondoGar:5,pctRetencion:0,
    inicio:"",fin:"",finAmpliado:"",justificacionAmpliacion:""
  });
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const valid=form.nombre&&form.contrato&&form.cliente&&form.presupuesto&&form.inicio&&form.fin;

  function seleccionarGP(obra) {
    setGpSel(obra);
    setForm(p=>({...p,
      id: "GP"+obra.id,
      nombre: obra.nombre,
      gastoGP: obra.gastoGP,
    }));
    setPaso("completar");
  }

  // Usar datos del Sheet si están disponibles, sino el catálogo estático
  const gpCatalogo = gpData
    ? Object.entries(gpData.obras).map(([key, val]) => ({
        id: key.slice(0,4),
        nombre: key.slice(5).trim(),
        gastoGP: val.semanas[gpData.ultimaSemana] || 0,
        semanas: val.semanas,
        rubros: val.rubros,
      }))
    : GP_OBRAS_CATALOGO;

  const gpFiltradas = gpCatalogo.filter(o =>
    !busqueda || o.nombre.toLowerCase().includes(busqueda.toLowerCase()) || o.id.includes(busqueda)
  );
  return <div style={{position:"fixed",inset:0,background:"rgba(13,22,25,0.92)",zIndex:200,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:C.card,borderRadius:12,padding:20,width:"100%",maxWidth:500,
      border:`0.5px solid ${C.borderM}`,maxHeight:"90vh",overflowY:"auto"}}>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:C.textPri}}>
            {paso==="seleccionar"?"Seleccionar obra de GP Construct":"Completar datos de la obra"}
          </div>
          {paso==="completar"&&gpSel&&(
            <div style={{fontSize:10,color:C.textMut,marginTop:2}}>
              {gpSel.id} — {gpSel.nombre}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.textMut,fontSize:18,cursor:"pointer"}}>×</button>
      </div>

      {/* PASO 1: Seleccionar de GP Construct */}
      {paso==="seleccionar"&&(
        <>
          <Inp placeholder="Buscar por nombre o ID..." value={busqueda}
            onChange={e=>setBusqueda(e.target.value)}
            style={{marginBottom:10}}/>
          <div style={{maxHeight:360,overflowY:"auto",display:"flex",flexDirection:"column",gap:5}}>
            {gpFiltradas.map(o=>(
              <div key={o.id} onClick={()=>seleccionarGP(o)}
                style={{background:C.bg,borderRadius:8,padding:"10px 14px",cursor:"pointer",
                  border:`0.5px solid ${C.border}`,transition:"border-color .15s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,254,249,0.35)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.textPri}}>{o.nombre}</div>
                    <div style={{fontSize:9,color:C.textMut}}>ID: {o.id} · Gasto 2026: {MXN(o.gastoGP)}</div>
                  </div>
                  <span style={{fontSize:10,color:C.caliza,fontWeight:700,flexShrink:0}}>Activar →</span>
                </div>
              </div>
            ))}
            {gpFiltradas.length===0&&(
              <div style={{textAlign:"center",padding:"24px 0",color:C.textMut,fontSize:12}}>
                No hay obras que coincidan con la búsqueda
              </div>
            )}
          </div>
          <div style={{marginTop:12}}>
            <SecBtn onClick={onClose} style={{width:"100%"}}>Cancelar</SecBtn>
          </div>
        </>
      )}

      {/* PASO 2: Completar datos */}
      {paso==="completar"&&(
        <>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {/* Nombre desde GP Construct — no editable */}
            <div>
              <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Nombre de la obra</div>
              <div style={{background:"rgba(255,254,249,0.05)",border:`0.5px solid ${C.border}`,
                borderRadius:6,padding:"7px 10px",fontSize:12,fontWeight:600,color:C.caliza,
                display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>{form.nombre}</span>
                <span style={{fontSize:9,color:C.textMut,flexShrink:0,marginLeft:8}}>ID {gpSel?.id}</span>
              </div>
            </div>
            {[["Contrato","contrato","text"],["Cliente","cliente","text"],
              ["Superintendente","superintendente","text"],["Residente de obra","residente","text"],
              ["Administrador","admin","text"]].map(([l,k,t])=>(
              <div key={k}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div>
                <Inp type={t} value={form[k]} onChange={e=>f(k,e.target.value)} placeholder={l}/>
              </div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[["Inicio","inicio","date"],["Fin programado (original)","fin","date"]].map(([l,k,t])=>(
                <div key={k}>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div>
                  <Inp type={t} value={form[k]} onChange={e=>f(k,e.target.value)}/>
                </div>
              ))}
            </div>
            <div>
              <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                Fin ampliado (si aplica)
              </div>
              <Inp type="date" value={form.finAmpliado} onChange={e=>f("finAmpliado",e.target.value)}/>
            </div>
            {form.finAmpliado&&<div>
              <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                Justificación de ampliación
              </div>
              <Inp type="text" value={form.justificacionAmpliacion}
                placeholder="Convenio modificatorio, causas de fuerza mayor, etc."
                onChange={e=>f("justificacionAmpliacion",e.target.value)}/>
            </div>}
            <div>
              <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Presupuesto total del contrato</div>
              <Inp type="number" value={form.presupuesto} onChange={e=>f("presupuesto",parseFloat(e.target.value)||0)} placeholder="0"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[["Anticipo %","pctAnticipo"],["Fondo gto. %","pctFondoGar"],["Ret. estratég. %","pctRetencion"]].map(([l,k])=>(
                <div key={k}>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div>
                  <Inp type="number" min="0" max="100" value={form[k]} onChange={e=>f(k,parseFloat(e.target.value)||0)}/>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:16}}>
            <SecBtn onClick={()=>setPaso("seleccionar")} style={{flex:1}}>← Cambiar obra</SecBtn>
            <button onClick={()=>valid&&onSave(form)} disabled={!valid}
              style={{flex:2,background:valid?C.caliza:"rgba(255,254,249,0.2)",border:"none",borderRadius:6,
                padding:"9px 0",fontSize:12,fontWeight:700,color:valid?C.bg:C.textMut,
                cursor:valid?"pointer":"not-allowed"}}>
              Activar en CAMPO
            </button>
          </div>
        </>
      )}
    </div>
  </div>;
}

function PantallaObras({onSelect,usuario,obras,setObras,gpData,gpLoading,gpUltActualiz,onRefreshGP}){
  // Debug
  if(!obras||!Array.isArray(obras)||obras.length===0){
    return <div style={{padding:20,color:C.red,fontSize:12}}>
      Error: obras no disponible ({typeof obras}, len={obras?.length})
    </div>;
  }
  const ec={activa:C.green,terminada:C.blue,pausada:C.yellow,archivada:C.textMut};
  const puedeGestionar=["director_operaciones","gerente_construccion"].includes(usuario.rol);
  const puedeEliminar=["director_operaciones","gerente_construccion"].includes(usuario.rol);
  const[orden,setOrden]=useState("nombre"); // nombre|importe_asc|importe_desc|avance_asc|avance_desc
  const[verHistorial,setVerHistorial]=useState(false);
  const[modalNueva,setModalNueva]=useState(false);
  const[confirmarArchivar,setConfirmarArchivar]=useState(null);
  const[confirmarEliminar,setConfirmarEliminar]=useState(null);
  const[idConfirm,setIdConfirm]=useState("");
  const[elimStep,setElimStep]=useState(1);

  const todasObras=PERMISOS[usuario.rol]?.todas_obras
    ? obras
    : [obras.find(o=>o.id==="OAX01")||obras[0]].filter(Boolean);
  const activas=todasObras.filter(o=>o.estado!=="archivada");
  const archivadas=todasObras.filter(o=>o.estado==="archivada");

  const ordenar=(lista)=>{
    const l=[...lista];
    if(orden==="importe_desc") return l.sort((a,b)=>b.presupuesto-a.presupuesto);
    if(orden==="importe_asc")  return l.sort((a,b)=>a.presupuesto-b.presupuesto);
    if(orden==="avance_desc")  return l.sort((a,b)=>b.gastoGP/b.presupuesto-a.gastoGP/a.presupuesto);
    if(orden==="avance_asc")   return l.sort((a,b)=>a.gastoGP/a.presupuesto-b.gastoGP/b.presupuesto);
    return l.sort((a,b)=>a.nombre.localeCompare(b.nombre));
  };

  const archivar=async(id)=>{
    const snap=JSON.stringify(obras.find(o=>o.id===id));
    try{
      const histPrev = await fsGet("global/historial_obras") || {obras:[]};
      const snap2 = obras.find(o=>o.id===id);
      histPrev.obras.push({...snap2,archivedAt:new Date().toISOString(),estado:"archivada"});
      await fsSet("global/historial_obras", histPrev);
    }catch(e){console.error('archivar',e);}
    setObras(oo=>oo.map(o=>o.id===id?{...o,estado:"archivada"}:o));
    setConfirmarArchivar(null);
  };

  const reactivar=(id)=>{
    setObras(oo=>oo.map(o=>o.id===id?{...o,estado:"activa"}:o));
  };

  const iniciarEliminar=(obra)=>{
    setConfirmarEliminar(obra); setIdConfirm(""); setElimStep(1);
  };

  const ejecutarEliminar=async()=>{
    if(!confirmarEliminar) return;
    // Eliminar de Firestore
    await fsDel(`obras/${confirmarEliminar.id}/config/info`);
    await fsDel(`obras/${confirmarEliminar.id}/config/parametros`);
    await fsDel(`obras/${confirmarEliminar.id}/config/estimaciones`);
    // Eliminar del estado local
    setObras(oo=>oo.filter(o=>o.id!==confirmarEliminar.id));
    setConfirmarEliminar(null); setIdConfirm(""); setElimStep(1);
  };

  const agregarObra=async(form)=>{
    const nueva={...form,presupuesto:parseFloat(form.presupuesto)||0};
    setObras(oo=>[...oo,nueva]);
    // Guardar en Firestore
    await fsSet(`obras/${nueva.id}/config/info`, nueva);
    setModalNueva(false);
  };

  const listaActual=ordenar(verHistorial?archivadas:activas);

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {modalNueva&&<ModalNuevaObra onSave={agregarObra} onClose={()=>setModalNueva(false)} gpData={gpData}/>}

    {/* Confirmación archivar */}
    {confirmarArchivar&&<div style={{position:"fixed",inset:0,background:"rgba(13,22,25,0.92)",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:C.card,borderRadius:12,padding:20,width:"100%",maxWidth:380,
        border:`0.5px solid ${C.red}44`}}>
        <div style={{fontSize:14,fontWeight:700,color:C.textPri,marginBottom:8}}>¿Archivar esta obra?</div>
        <div style={{fontSize:12,color:C.textSec,marginBottom:4}}>
          <b>{confirmarArchivar.nombre}</b>
        </div>
        <div style={{fontSize:11,color:C.textMut,marginBottom:16}}>
          La obra quedará en el historial y podrá reactivarse en cualquier momento. Los datos no se eliminarán.
        </div>
        <div style={{display:"flex",gap:8}}>
          <SecBtn onClick={()=>setConfirmarArchivar(null)} style={{flex:1}}>Cancelar</SecBtn>
          <button onClick={()=>archivar(confirmarArchivar.id)}
            style={{flex:2,background:C.red,border:"none",borderRadius:6,padding:"9px 0",
              fontSize:12,fontWeight:700,color:C.caliza,cursor:"pointer"}}>
            Sí, archivar
          </button>
        </div>
      </div>
    </div>}

    {/* Modal eliminar obra — doble confirmación */}
    {confirmarEliminar&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:210,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"white",borderRadius:12,padding:20,width:"100%",maxWidth:400,
        border:`1px solid ${C.border}`,boxShadow:"0 16px 48px rgba(0,0,0,0.2)"}}>
        {elimStep===1&&<>
          <div style={{fontSize:13,fontWeight:600,color:C.redDk,marginBottom:8}}>
            Eliminar obra permanentemente
          </div>
          <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginBottom:4}}>
            {confirmarEliminar.nombre}
          </div>
          <div style={{fontSize:11,color:C.textSec,marginBottom:16,lineHeight:1.6}}>
            Esta acción es irreversible. Se eliminarán todos los datos, avances,
            estimaciones y documentos de esta obra.
          </div>
          <div style={{display:"flex",gap:8}}>
            <SecBtn onClick={()=>{setConfirmarEliminar(null);setElimStep(1);}} style={{flex:1}}>Cancelar</SecBtn>
            <button onClick={()=>setElimStep(2)}
              style={{flex:2,background:C.redDk,border:"none",borderRadius:6,padding:"9px 0",
                fontSize:12,fontWeight:600,color:"white",cursor:"pointer"}}>
              Continuar
            </button>
          </div>
        </>}
        {elimStep===2&&<>
          <div style={{fontSize:13,fontWeight:600,color:C.redDk,marginBottom:12}}>
            Escribe el ID de la obra para confirmar
          </div>
          <div style={{background:C.bg,borderRadius:6,padding:"8px 12px",
            fontSize:13,fontWeight:700,color:C.textPri,marginBottom:10,textAlign:"center",
            letterSpacing:"0.12em",fontFamily:"monospace",border:`1px solid ${C.border}`}}>
            {confirmarEliminar.id}
          </div>
          <input value={idConfirm} onChange={e=>setIdConfirm(e.target.value)}
            placeholder={`Escribe: ${confirmarEliminar.id}`}
            style={{background:"white",border:`1px solid ${idConfirm===confirmarEliminar.id?C.redDk:C.border}`,
              borderRadius:6,padding:"8px 12px",color:C.textPri,fontSize:12,width:"100%",
              outline:"none",marginBottom:12,fontFamily:"monospace",letterSpacing:"0.08em"}}/>
          <div style={{display:"flex",gap:8}}>
            <SecBtn onClick={()=>setElimStep(1)} style={{flex:1}}>Atras</SecBtn>
            <button onClick={ejecutarEliminar} disabled={idConfirm!==confirmarEliminar.id}
              style={{flex:2,
                background:idConfirm===confirmarEliminar.id?C.redDk:C.border,
                border:"none",borderRadius:6,padding:"9px 0",fontSize:12,fontWeight:600,
                color:idConfirm===confirmarEliminar.id?"white":C.textMut,
                cursor:idConfirm===confirmarEliminar.id?"pointer":"not-allowed"}}>
              Eliminar definitivamente
            </button>
          </div>
        </>}
      </div>
    </div>}

    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",paddingBottom:6}}>
      <div>
        <div style={{fontSize:15,fontWeight:700,color:C.textPri,marginBottom:3}}>
          Bienvenido, {usuario.nombre.split(" ")[0]}
        </div>
        <div style={{fontSize:11,color:C.textMut}}>
          {ROL_LABEL[usuario.rol]} · FOSMON Construcciones · {activas.length} obra(s) activa(s)
        </div>
        {gpUltActualiz&&<div style={{fontSize:9,color:C.textMut,marginTop:2}}>
          GP Construct: {gpUltActualiz}
          {onRefreshGP&&<button onClick={onRefreshGP} style={{background:"none",border:"none",
            color:C.caliza,fontSize:9,cursor:"pointer",marginLeft:6}}>↻ Actualizar</button>}
        </div>}
      </div>
      {puedeGestionar&&<button onClick={()=>setModalNueva(true)}
        style={{background:C.caliza,border:"none",borderRadius:8,padding:"7px 14px",
          fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer",flexShrink:0}}>
        + Nueva obra
      </button>}
    </div>

    {/* Controles de orden e historial */}
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <Sel value={orden} onChange={e=>setOrden(e.target.value)}
        style={{fontSize:10,padding:"5px 8px",flex:1,minWidth:160}}>
        <option value="nombre">Ordenar: A → Z</option>
        <option value="importe_desc">Importe: Mayor → Menor</option>
        <option value="importe_asc">Importe: Menor → Mayor</option>
        <option value="avance_desc">Avance: Mayor → Menor</option>
        <option value="avance_asc">Avance: Menor → Mayor</option>
      </Sel>
      {puedeGestionar&&archivadas.length>0&&<button onClick={()=>setVerHistorial(v=>!v)}
        style={{background:verHistorial?C.caliza:C.card,border:`0.5px solid ${C.borderM}`,
          borderRadius:6,padding:"5px 12px",fontSize:10,
          color:verHistorial?C.bg:C.textSec,cursor:"pointer",whiteSpace:"nowrap"}}>
        {verHistorial?`← Obras activas`:` Historial (${archivadas.length})`}
      </button>}
    </div>

    {/* Lista de obras */}
    {listaActual.length===0&&<div style={{background:C.card,borderRadius:10,padding:24,
      textAlign:"center",color:C.textMut,fontSize:12}}>
      {verHistorial?"No hay obras archivadas":"No hay obras activas"}
    </div>}

    {listaActual.map(o=>{
      const pg=o.presupuesto>0?(o.gastoGP/o.presupuesto)*100:0;
      const col=ec[o.estado]||C.caliza;
      const archivada=o.estado==="archivada";
      return <div key={o.id} style={{background:C.card,border:`0.5px solid ${archivada?"rgba(255,254,249,0.05)":C.border}`,
        borderRadius:10,padding:"14px 16px",opacity:archivada?0.7:1,
        cursor:archivada?"default":"pointer",transition:"border-color .15s"}}
        onClick={()=>!archivada&&onSelect(o.id)}
        onMouseEnter={e=>{if(!archivada)e.currentTarget.style.borderColor="rgba(255,254,249,0.35)"}}
        onMouseLeave={e=>e.currentTarget.style.borderColor=archivada?"rgba(255,254,249,0.05)":C.border}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:C.textPri,marginBottom:2}}>{o.nombre}</div>
            <div style={{fontSize:10,color:C.textMut}}>{o.contrato} · {o.cliente}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0,marginLeft:10}}>
            <Bdg color={col}>{o.estado.toUpperCase()}</Bdg>
            <span style={{fontSize:9,color:C.textMut}}>Act: {o.ultimaAct}</span>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:9}}>
          {[["Presupuesto",MXN(o.presupuesto),C.textPri],["Gasto GP",MXN(o.gastoGP),C.red],
            ["Anticipo/FG",`${o.pctAnticipo}%/${o.pctFondoGar}%`,C.textSec]].map(([l,v,c])=>
            <div key={l}><div style={{fontSize:9,color:C.textMut,marginBottom:1}}>{l}</div>
              <div style={{fontSize:12,fontWeight:500,color:c}}>{v}</div></div>)}
        </div>
        <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:3,overflow:"hidden",marginBottom:8}}>
          <div style={{width:`${Math.min(pg,100).toFixed(1)}%`,height:"100%",
            background:`linear-gradient(90deg,${C.caliza},${C.red})`,borderRadius:99}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:C.textMut}}>
          <span>{o.superintendente}</span>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {puedeGestionar&&!archivada&&<button onClick={e=>{e.stopPropagation();setConfirmarArchivar(o);}}
              style={{background:"none",border:`0.5px solid rgba(220,38,38,0.3)`,borderRadius:4,
                padding:"2px 7px",fontSize:9,color:C.red,cursor:"pointer"}}>
              Archivar
            </button>}
            {puedeGestionar&&archivada&&<button onClick={e=>{e.stopPropagation();reactivar(o.id);}}
              style={{background:"none",border:`1px solid ${C.greenBg}`,borderRadius:4,
                padding:"2px 7px",fontSize:9,color:C.greenDk,cursor:"pointer"}}>
              Reactivar
            </button>}
            {puedeEliminar&&<button onClick={e=>{e.stopPropagation();iniciarEliminar(o);}}
              style={{background:"none",border:`0.5px solid rgba(220,38,38,0.3)`,borderRadius:4,
                padding:"2px 7px",fontSize:9,color:C.red,cursor:"pointer",opacity:0.7}}>
              Eliminar
            </button>}
            {!archivada&&<span style={{color:C.caliza,fontWeight:700}}>Ver obra →</span>}
          </div>
        </div>
      </div>;
    })}
  </div>;
}


// ── GRÁFICA INTERACTIVA DE PROYECCIÓN ─────────────────────────────────────
function GraficaProyeccion({obra, subs, estimaciones, maquinaria, ampliaciones=[]}) {
  const [hovered, setHovered] = React.useState(null);
  const [activeLines, setActiveLines] = React.useState({
    gasto:true, monto:true, estimado:true, metaG:true, metaA:true
  });
  const svgRef = useRef();

  // Calcular datos reales de la obra
  const presupuesto = obra.presupuesto / 1e6;
  const gastoGP     = obra.gastoGP / 1e6;
  const am          = subs.reduce((t,s)=>t+(s.a/100)*s.imp,0) / 1e6;
  const alm         = 0; // materiales en almacén
  const montoEjec   = am + alm;
  const totalEst    = estimaciones.reduce((t,e)=>t+e.monto,0) / 1e6;

  // Semanas simuladas históricas + proyección
  const HOY_IDX = 4;
  const ritmoG  = gastoGP / 18;  // aprox semanas transcurridas
  const ritmoM  = montoEjec / 18;
  const SEMANAS_DATA = Array.from({length:20}, (_,i) => {
    const esReal = i <= HOY_IDX;
    const factor = i / HOY_IDX;
    return {
      s: `S${14+i}`,
      g: esReal ? +(gastoGP * factor).toFixed(1) : +(gastoGP + ritmoG*(i-HOY_IDX)).toFixed(1),
      m: esReal ? +(montoEjec * factor).toFixed(1) : +(montoEjec + ritmoM*(i-HOY_IDX)).toFixed(1),
      e: esReal ? (i<3?0:+(totalEst*(i/HOY_IDX)).toFixed(1)) : +(totalEst + (presupuesto*0.15)*(i-HOY_IDX)/3).toFixed(1),
      p: esReal ? +(am/presupuesto*100 * factor).toFixed(1) : +(am/presupuesto*100 + (am/presupuesto*100/HOY_IDX)*(i-HOY_IDX)).toFixed(1),
      real: esReal,
    };
  });

  const PLAZO_ORIG = Math.round((new Date(obra.fin)-new Date(obra.inicio))/(7*24*60*60*1000));
  const PLAZO_IDX  = Math.min(Math.round(PLAZO_ORIG/1), 16);
  const PLAZOA_IDX = Math.min(PLAZO_IDX + 4, 19);

  const n = SEMANAS_DATA.length;
  const PAD = {top:24,right:80,bottom:38,left:52};
  const SW = 680; const SH = 260;
  const W = SW-PAD.left-PAD.right; const H = SH-PAD.top-PAD.bottom;
  const maxY = presupuesto * 1.08;
  const xS = i => (i/(n-1))*W;
  const yS = v => H - (v/maxY)*H;

  const makePath = (fn, fromIdx=0) => SEMANAS_DATA
    .slice(fromIdx).map((s,i) => `${i===0?'M':'L'} ${xS(fromIdx+i)} ${yS(fn(s))}`).join(' ');
  const makeRealPath  = fn => SEMANAS_DATA.filter(s=>s.real).map((s,i)=>`${i===0?'M':'L'} ${xS(SEMANAS_DATA.indexOf(s))} ${yS(fn(s))}`).join(' ');
  const makeProjPath  = fn => SEMANAS_DATA.map((s,i)=>i<HOY_IDX?null:`${i===HOY_IDX?'M':'L'} ${xS(i)} ${yS(fn(s))}`).filter(Boolean).join(' ');

  const semsFinG = Math.ceil((presupuesto - gastoGP) / ritmoG);
  const semsFinM = Math.ceil((presupuesto - montoEjec) / ritmoM);
  const semsRest = PLAZO_IDX - HOY_IDX;
  const metaG = semsRest > 0 ? (presupuesto - gastoGP) / semsRest : ritmoG * 1.5;
  const metaM = semsRest > 0 ? (presupuesto - montoEjec) / semsRest : ritmoM * 1.5;

  const metaGPath = SEMANAS_DATA.map((s,i)=>i<HOY_IDX?null:`${i===HOY_IDX?'M':'L'} ${xS(i)} ${yS(Math.min(gastoGP+metaG*(i-HOY_IDX),presupuesto))}`).filter(Boolean).join(' ');
  const metaMPath = SEMANAS_DATA.map((s,i)=>i<HOY_IDX?null:`${i===HOY_IDX?'M':'L'} ${xS(i)} ${yS(Math.min(montoEjec+metaM*(i-HOY_IDX),presupuesto))}`).filter(Boolean).join(' ');

  const hovD = hovered!==null ? SEMANAS_DATA[hovered] : null;

  const toggleLine = k => setActiveLines(p=>({...p,[k]:!p[k]}));

  return (
    <Card>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10,flexWrap:'wrap',gap:8}}>
        <div>
          <Tit>Proyección de avance y gasto</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>
            Pasa el cursor sobre la gráfica para ver el detalle por semana
          </div>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[
            {k:'gasto',   col:C.red,    lbl:'Gasto GP'},
            {k:'monto',   col:C.blue,   lbl:'Monto ejecutado'},
            {k:'estimado',col:C.green,  lbl:'Estimado'},
            {k:'metaG',   col:C.orange, lbl:'Meta gasto'},
            {k:'metaA',   col:C.purple, lbl:'Meta avance'},
          ].map(({k,col,lbl})=>(
            <button key={k} onClick={()=>toggleLine(k)}
              style={{display:'flex',alignItems:'center',gap:4,background:'none',
                border:`0.5px solid ${activeLines[k]?col:'rgba(255,254,249,0.12)'}`,
                borderRadius:99,padding:'2px 8px',cursor:'pointer',
                opacity:activeLines[k]?1:0.4,transition:'all .2s'}}>
              <div style={{width:14,height:2,background:col,borderRadius:1}}/>
              <span style={{fontSize:9,color:activeLines[k]?C.caliza:C.textMut}}>{lbl}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{position:'relative',overflowX:'auto'}}>
        <svg ref={svgRef} width={SW} height={SH}
          onMouseMove={e=>{const r=svgRef.current?.getBoundingClientRect();if(!r)return;const mx=e.clientX-r.left-PAD.left;const idx=Math.round((mx/W)*(n-1));if(idx>=0&&idx<n)setHovered(idx);}}
          onMouseLeave={()=>setHovered(null)}
          style={{cursor:'crosshair',overflow:'visible',display:'block'}}>
          <defs>
            <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.red} stopOpacity="0.2"/>
              <stop offset="100%" stopColor={C.red} stopOpacity="0.01"/>
            </linearGradient>
            <linearGradient id="gB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.blue} stopOpacity="0.15"/>
              <stop offset="100%" stopColor={C.blue} stopOpacity="0.01"/>
            </linearGradient>
            <filter id="gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* Grid */}
            {[0,25,50,75,100,presupuesto].map(v=>(
              <g key={v}>
                <line x1={0} y1={yS(v*presupuesto/100)} x2={W} y2={yS(v*presupuesto/100)}
                  stroke={v===100?C.caliza:C.border} strokeWidth={v===100?0.6:0.3}
                  strokeDasharray={v===100?'4,4':''} opacity={v===100?0.3:0.5}/>
                <text x={-6} y={yS(v*presupuesto/100)+4} fill={C.textMut} fontSize={8} textAnchor="end">
                  {v===100?'Ppto':`$${(v*presupuesto/100).toFixed(0)}M`}
                </text>
              </g>
            ))}
            {/* Zonas plazo */}
            {PLAZO_IDX < n && <rect x={xS(HOY_IDX+1)} y={0} width={xS(PLAZO_IDX)-xS(HOY_IDX+1)} height={H} fill={C.green} fillOpacity={0.04}/>}
            {ampliaciones.length>0 && PLAZOA_IDX < n && PLAZO_IDX < n && <rect x={xS(PLAZO_IDX)} y={0} width={xS(PLAZOA_IDX)-xS(PLAZO_IDX)} height={H} fill={C.yellow} fillOpacity={0.06}/>}
            {/* Líneas plazo */}
            {PLAZO_IDX<n && <><line x1={xS(PLAZO_IDX)} y1={0} x2={xS(PLAZO_IDX)} y2={H} stroke={C.green} strokeWidth={1} strokeDasharray="4,4" opacity={0.55}/>
            <text x={xS(PLAZO_IDX)-3} y={12} fill={C.green} fontSize={7.5} textAnchor="end" fontWeight="600" opacity={0.8}>Plazo orig.</text></>}
            {ampliaciones.length>0 && PLAZOA_IDX<n && <><line x1={xS(PLAZOA_IDX)} y1={0} x2={xS(PLAZOA_IDX)} y2={H} stroke={C.yellow} strokeWidth={1} strokeDasharray="3,4" opacity={0.65}/>
            <text x={xS(PLAZOA_IDX)+3} y={12} fill={C.yellow} fontSize={7.5} textAnchor="start" fontWeight="600" opacity={0.8}>Amp.</text></>}
          {/* Ampliaciones adicionales desde Contrato */}
          {ampliaciones.map((amp,ai)=>{
            if(!amp.fecha||!obra.inicio) return null;
            const ampMs=(new Date(amp.fecha)-new Date(obra.inicio))/(7*24*60*60*1000);
            const ampIdx=Math.min(Math.round(ampMs),n-1);
            const col=[C.yellow,C.orange,C.pink][ai]||C.orange;
            return <g key={amp.id||ai}>
              <line x1={xS(ampIdx)} y1={0} x2={xS(ampIdx)} y2={H} stroke={col} strokeWidth={1.2} strokeDasharray="4,3" opacity={0.7}/>
              <text x={xS(ampIdx)+3} y={24+ai*10} fill={col} fontSize={7} textAnchor="start" fontWeight="600" opacity={0.85}>{amp.label||`Amp.${ai+1}`}</text>
            </g>;
          })}
            {/* Línea HOY */}
            <line x1={xS(HOY_IDX)} y1={0} x2={xS(HOY_IDX)} y2={H} stroke={C.textMut} strokeWidth={0.8} opacity={0.5}/>
            <text x={xS(HOY_IDX)} y={H+28} fill={C.textMut} fontSize={7.5} textAnchor="middle">Hoy</text>
            {/* Áreas */}
            {activeLines.gasto&&<path d={`${makeRealPath(s=>s.g)} L ${xS(HOY_IDX)} ${H} L ${xS(0)} ${H} Z`} fill="url(#gR)" opacity={0.7}/>}
            {activeLines.monto&&<path d={`${makeRealPath(s=>s.m)} L ${xS(HOY_IDX)} ${H} L ${xS(0)} ${H} Z`} fill="url(#gB)" opacity={0.6}/>}
            {/* Metas */}
            {activeLines.metaG&&<path d={metaGPath} fill="none" stroke={C.orange} strokeWidth={1.2} strokeDasharray="3,5" opacity={0.5}/>}
            {activeLines.metaA&&<path d={metaMPath} fill="none" stroke={C.purple} strokeWidth={1.2} strokeDasharray="3,5" opacity={0.5}/>}
            {/* Proyecciones punteadas */}
            {activeLines.gasto&&<path d={makeProjPath(s=>s.g)} fill="none" stroke={C.red} strokeWidth={1.6} strokeDasharray="5,4" opacity={0.45}/>}
            {activeLines.monto&&<path d={makeProjPath(s=>s.m)} fill="none" stroke={C.blue} strokeWidth={1.6} strokeDasharray="5,4" opacity={0.45}/>}
            {activeLines.estimado&&<path d={makeProjPath(s=>s.e)} fill="none" stroke={C.green} strokeWidth={1.6} strokeDasharray="5,4" opacity={0.4}/>}
            {/* Líneas reales */}
            {activeLines.gasto&&<path d={makeRealPath(s=>s.g)} fill="none" stroke={C.red} strokeWidth={2.2} filter="url(#gl)" strokeLinecap="round" strokeLinejoin="round"/>}
            {activeLines.monto&&<path d={makeRealPath(s=>s.m)} fill="none" stroke={C.blue} strokeWidth={2.2} filter="url(#gl)" strokeLinecap="round" strokeLinejoin="round"/>}
            {activeLines.estimado&&<path d={makeRealPath(s=>s.e)} fill="none" stroke={C.green} strokeWidth={2.2} filter="url(#gl)" strokeLinecap="round" strokeLinejoin="round"/>}
            {/* Puntos reales */}
            {SEMANAS_DATA.filter(s=>s.real).map((s,i)=>{
              const idx=SEMANAS_DATA.indexOf(s);
              return <g key={s.s}>
                {activeLines.gasto&&<circle cx={xS(idx)} cy={yS(s.g)} r={hovered===idx?5.5:3.5} fill={C.red} stroke={C.bg} strokeWidth={1.5} style={{transition:'r .15s'}}/>}
                {activeLines.monto&&<rect x={xS(idx)-3} y={yS(s.m)-3} width={hovered===idx?7:5} height={hovered===idx?7:5} fill={C.blue} stroke={C.bg} strokeWidth={1.5} style={{transition:'all .15s'}}/>}
                {activeLines.estimado&&<polygon points={`${xS(idx)},${yS(s.e)-4.5} ${xS(idx)+3.5},${yS(s.e)+3} ${xS(idx)-3.5},${yS(s.e)+3}`} fill={C.green} stroke={C.bg} strokeWidth={1.5}/>}
              </g>;
            })}
            {/* Crosshair hover */}
            {hovered!==null&&<>
              <line x1={xS(hovered)} y1={0} x2={xS(hovered)} y2={H} stroke={C.caliza} strokeWidth={0.7} opacity={0.25} strokeDasharray="2,3"/>
              {activeLines.gasto&&<circle cx={xS(hovered)} cy={yS(SEMANAS_DATA[hovered].g)} r={6} fill="none" stroke={C.red} strokeWidth={1.8} opacity={0.8}/>}
              {activeLines.monto&&<circle cx={xS(hovered)} cy={yS(SEMANAS_DATA[hovered].m)} r={6} fill="none" stroke={C.blue} strokeWidth={1.8} opacity={0.8}/>}
              {activeLines.estimado&&<circle cx={xS(hovered)} cy={yS(SEMANAS_DATA[hovered].e)} r={6} fill="none" stroke={C.green} strokeWidth={1.8} opacity={0.8}/>}
            </>}
            {/* X labels */}
            {SEMANAS_DATA.map((s,i)=>i%3===0&&(
              <text key={s.s} x={xS(i)} y={H+16} fill={i===HOY_IDX?C.caliza:C.textMut}
                fontSize={8} textAnchor="middle" fontWeight={i===HOY_IDX?'700':'400'} opacity={i===HOY_IDX?1:0.65}>{s.s}</text>
            ))}
          </g>
        </svg>

        {/* Tooltip */}
        {hovD&&(
          <div style={{position:'absolute',left:Math.min(PAD.left+xS(hovered)+12,490),top:PAD.top+10,
            background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
            padding:'10px 14px',boxShadow:'0 8px 32px rgba(0,0,0,0.7)',pointerEvents:'none',minWidth:180,
            backdropFilter:'blur(12px)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:13,fontWeight:700,color:C.caliza,fontFamily:'monospace'}}>{hovD.s}</span>
              <Bdg color={hovD.real?C.green:C.yellow} small>{hovD.real?'REAL':'PROYECT.'}</Bdg>
            </div>
            {[
              {lbl:'Gasto GP acumulado', val:`$${hovD.g.toFixed(1)}M`, col:C.red,    show:activeLines.gasto},
              {lbl:'Monto ejecutado',    val:`$${hovD.m.toFixed(1)}M`, col:C.blue,   show:activeLines.monto},
              {lbl:'Estimado al cliente',val:`$${hovD.e.toFixed(1)}M`, col:C.green,  show:activeLines.estimado},
              {lbl:'Avance físico',      val:`${hovD.p.toFixed(1)}%`,  col:C.caliza, show:true},
            ].filter(r=>r.show).map(r=>(
              <div key={r.lbl} style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,gap:10}}>
                <div style={{display:'flex',alignItems:'center',gap:5}}>
                  <div style={{width:7,height:7,borderRadius:'50%',background:r.col,flexShrink:0}}/>
                  <span style={{fontSize:9,color:C.textSec}}>{r.lbl}</span>
                </div>
                <span style={{fontSize:10,fontWeight:700,color:r.col,fontFamily:'monospace'}}>{r.val}</span>
              </div>
            ))}
            {!hovD.real&&<>
              <div style={{height:1,background:C.border,margin:'6px 0'}}/>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:8.5,color:C.textMut,marginTop:2}}>
                <span>Meta gasto:</span>
                <span style={{color:C.orange}}>${Math.min(gastoGP+metaG*(hovered-HOY_IDX),presupuesto).toFixed(1)}M</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:8.5,color:C.textMut,marginTop:2}}>
                <span>Meta avance:</span>
                <span style={{color:C.purple}}>${Math.min(montoEjec+metaM*(hovered-HOY_IDX),presupuesto).toFixed(1)}M</span>
              </div>
            </>}
          </div>
        )}
      </div>

      {/* Resumen inferior */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
        {[
          ['Ritmo gasto/sem', `$${(ritmoG).toFixed(1)}M`, C.red],
          ['Ritmo avance/sem', `$${(ritmoM).toFixed(1)}M`, C.blue],
          [`Fin proyect. (gasto)`, `S${14+semsFinG}`, C.red],
          [`Fin proyect. (avance)`, `S${14+semsFinM}`, C.blue],
        ].map(([l,v,c])=>(
          <div key={l} style={{background:C.bg,borderRadius:7,padding:'7px 9px',borderLeft:`2px solid ${c}`}}>
            <div style={{fontSize:8,color:C.textMut,marginBottom:2}}>{l}</div>
            <div style={{fontSize:12,fontWeight:700,color:c,fontFamily:'monospace'}}>{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
function Dashboard({obra,subs,maquinaria,materiales,estimaciones}){
  const[lbFoto,setLbFoto]=useState(null);
  const gt=obra.gastoGP+maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const am=subs.reduce((t,s)=>t+(s.a/100)*s.imp,0);
  const alm=materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const me=am+alm; const af=subs.reduce((t,s)=>t+(s.a/100)*(s.imp/obra.presupuesto)*100,0);
  const diff=me-gt; const mpct=me>0?(diff/me)*100:0; const mc=semM(mpct);
  const dir=NOMINA_S18.filter(p=>p.tipo==="D").length;
  const ind=NOMINA_S18.filter(p=>p.tipo==="I").length;
  const cE=e=>{const a=e.monto*obra.pctAnticipo/100,fg=e.monto*obra.pctFondoGar/100;return{a,fg,ef:e.monto-a-fg};};
  const estPag   =estimaciones.filter(e=>e.estatus==="Pagada").reduce((t,e)=>t+e.monto,0);
  const estPorCob=estimaciones.filter(e=>["Facturada","Aprobada"].includes(e.estatus)).reduce((t,e)=>t+e.monto,0);
  const estProc  =estimaciones.filter(e=>e.estatus==="En proceso").reduce((t,e)=>t+e.monto,0);
  const estTotal =estimaciones.reduce((t,e)=>t+e.monto,0);
  const estFact  =estPorCob;
  const estRet   =estimaciones.reduce((t,e)=>t+cE(e).fg,0);
  const estAmort =estimaciones.filter(e=>e.estatus!=="Pagada").reduce((t,e)=>t+cE(e).a,0);
  const totalEst =estTotal;
  const top4=subs.slice(0,4); const maxI=top4[0]?.imp||1;
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
      <Kpi label="Avance físico"   value={`${NUM(af,1)}%`} sub="ponderado"      color={semA(af)}/>
      <Kpi label="Monto ejecutado" value={MXN(me)}         sub="monto ejecutado" color={C.blue} size={12}/>
      <Kpi label="Gasto total"     value={MXN(gt)}         sub="GP+maquinaria"  color={C.red}  size={12}/>
      <Kpi label="Personal campo"  value={dir+ind}         sub={`${dir}D · ${ind}I`} color={C.green}/>
    </div>
    <Card accent={mc}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div><Tit>Margen bruto de obra</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>Monto ejecutado − Gasto total</div></div>
        <div style={{background:`${mc}22`,border:`0.5px solid ${mc}44`,borderRadius:4,
          padding:"3px 9px",fontSize:10,fontWeight:600,color:mc,whiteSpace:"nowrap"}}>
          {me===0?"Sin avance":mpct>15?"Saludable":mpct>=6?"En vigilancia":"Crítico"}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[[MXN(me),"Monto ejecutado",C.blue,"avance+almacén"],[MXN(gt),"Gasto total",C.red,"GP+maquinaria"],
          [`${diff>=0?"+":""}${MXN(diff)}`,"Diferencia",mc,`margen ${NUM(mpct,1)}%`]].map(([v,l,c,s])=>
          <div key={l} style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${c}`}}>
            <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>{l}</div>
            <div style={{fontSize:13,fontWeight:600,color:c}}>{v}</div>
            <div style={{fontSize:9,color:C.textMut}}>{s}</div>
          </div>)}
      </div>
      <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:9,overflow:"hidden",position:"relative"}}>
        <div style={{width:`${Math.min((gt/obra.presupuesto)*100,100).toFixed(1)}%`,height:"100%",
          background:`linear-gradient(90deg,${C.caliza},${C.red})`,borderRadius:99}}/>
        <div style={{position:"absolute",top:0,height:"100%",left:"85%",width:1.5,background:C.yellow}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginTop:3}}>
        <span>$0</span><span style={{color:C.yellow}}>↑ umbral 15%</span><span>{MXN(obra.presupuesto)}</span>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <Tit>Estimaciones</Tit>
        <span style={{fontSize:9,color:C.textMut}}>{estimaciones.length} est. · Amort {obra.pctAnticipo}% · FG {obra.pctFondoGar}%</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
        <Kpi label="Pagado"        value={MXN(estPag)}    sub="cobrado y liquidado"    color={C.greenDk}  size={12}/>
        <Kpi label="Por cobrar"    value={MXN(estPorCob)} sub="facturado + aprobado"   color={C.purpleDk} size={12}/>
        <Kpi label="En proceso"    value={MXN(estProc)}   sub="en elaboración"          color={C.yellowDk} size={12}/>
        <Kpi label="Total estimado"value={MXN(estTotal)}  sub={`${(estTotal/obra.presupuesto*100).toFixed(1)}% del contrato`} color={C.blueDk} size={12}/>
      </div>
    </Card>
    {/* ── MONTO EJECUTADO vs ESTIMADO ── */}
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div>
          <Tit>Monto ejecutado vs Estimaciones</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>
            Obra ejecutada en campo comparada con lo facturado al cliente
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.blue}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Monto ejecutado</div>
          <div style={{fontSize:13,fontWeight:700,color:C.blue}}>{MXN(am)}</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{NUM(am/obra.presupuesto*100,1)}% del presupuesto</div>
        </div>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.purple}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Estimado acumulado</div>
          <div style={{fontSize:13,fontWeight:700,color:C.purple}}>{MXN(totalEst)}</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{NUM(totalEst/obra.presupuesto*100,1)}% del presupuesto</div>
        </div>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",
          borderLeft:`3px solid ${am>=totalEst?C.green:C.yellow}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Por estimar (cobrar)</div>
          <div style={{fontSize:13,fontWeight:700,color:am>=totalEst?C.green:C.yellow}}>{MXN(Math.max(am-totalEst,0))}</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>obra ejecutada sin facturar</div>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        {[
          ["Monto ejecutado", am, C.blue],
          ["Estimado acumulado", totalEst, C.purple],
        ].map(([lbl,val,col])=><div key={lbl} style={{marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginBottom:3}}>
            <span>{lbl}</span>
            <span style={{color:col,fontWeight:600}}>{MXN(val)} · {NUM(val/obra.presupuesto*100,1)}%</span>
          </div>
          <div style={{background:"rgba(255,254,249,0.08)",borderRadius:99,height:7,overflow:"hidden"}}>
            <div style={{width:`${Math.min(val/obra.presupuesto*100,100).toFixed(1)}%`,height:"100%",
              background:col,borderRadius:99,transition:"width .5s"}}/>
          </div>
        </div>)}
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginBottom:3}}>
          <span>Presupuesto total</span>
          <span style={{color:C.caliza,fontWeight:600}}>{MXN(obra.presupuesto)} · 100%</span>
        </div>
        <div style={{background:"rgba(255,254,249,0.15)",borderRadius:99,height:7,overflow:"hidden"}}>
          <div style={{width:"100%",height:"100%",background:"rgba(255,254,249,0.1)",borderRadius:99}}/>
        </div>
      </div>
      {(()=>{
        const inicioMs=new Date(obra.inicio).getTime();
        const finMs=new Date(obra.fin).getTime();
        const hoyMs=new Date("2026-05-27").getTime();
        const plazoTotal=(finMs-inicioMs)/(1000*60*60*24);
        const plazoTrans=Math.max((hoyMs-inicioMs)/(1000*60*60*24),1);
        const plazoRest=Math.max((finMs-hoyMs)/(1000*60*60*24),0);
        const pctPlazo=Math.min(plazoTrans/plazoTotal*100,100);
        const ritmoSem=am>0&&plazoTrans>0?am/(plazoTrans/7):0;
        const semRest=plazoRest/7;
        const proyFin=am+ritmoSem*semRest;
        const pctProy=Math.min(proyFin/obra.presupuesto*100,100);
        const faltaEst=Math.max(obra.presupuesto-totalEst,0);
        const semsParaEst=ritmoSem>0?Math.ceil(faltaEst/ritmoSem):null;
        return <div style={{borderTop:`0.5px solid ${C.border}`,paddingTop:10}}>
          <div style={{fontSize:9,color:C.textMut,fontWeight:600,textTransform:"uppercase",
            letterSpacing:"0.05em",marginBottom:8}}>Proyección al término de obra</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
            {[
              ["Plazo transcurrido", `${NUM(pctPlazo,0)}%`, `${Math.round(plazoTrans)} de ${plazoTotal} días`, C.caliza],
              ["Ritmo semanal", MXN(ritmoSem), "avance / semana", C.blue],
              ["Proyección al fin", `${NUM(pctProy,1)}%`, MXN(proyFin)+" proyectado", pctProy>=95?C.green:pctProy>=75?C.yellow:C.red],
              ["Semanas p/ estimar", semsParaEst?`~${semsParaEst} sem`:"—", MXN(faltaEst)+" por estimar", semsParaEst&&semsParaEst<=semRest?C.green:C.yellow],
            ].map(([l,v,s,c])=><div key={l} style={{background:C.bg,borderRadius:7,padding:"8px 10px"}}>
              <div style={{fontSize:8,color:C.textMut,marginBottom:3}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
              <div style={{fontSize:8,color:C.textMut,marginTop:2}}>{s}</div>
            </div>)}
          </div>
          {pctProy<95?<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.25)",
            borderRadius:7,padding:"7px 10px",fontSize:10,color:C.yellow}}>
             Al ritmo actual la obra terminaría al <b>{NUM(pctProy,1)}%</b> del presupuesto.
            Se requiere acelerar <b>{MXN((obra.presupuesto-proyFin)/Math.max(semRest,1))}/sem</b> adicionales.
          </div>:<div style={{background:"rgba(22,163,74,0.1)",border:"0.5px solid rgba(22,163,74,0.25)",
            borderRadius:7,padding:"7px 10px",fontSize:10,color:C.green}}>
             Al ritmo actual la obra termina dentro del presupuesto contratado.
          </div>}
        </div>;
      })()}
    </Card>

    <GraficaProyeccion obra={obra} subs={subs} estimaciones={estimaciones} maquinaria={maquinaria} ampliaciones={[...(obra.finAmpliado?[{fecha:obra.finAmpliado,label:"Ampliación 1"}]:[])]}/>

    <Card>
      <Tit>Personal en campo — Semana 18</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        <Kpi label="Total"     value={dir+ind} sub="trabajadores"  color={C.caliza}/>
        <Kpi label="Directo"   value={dir}     sub="mano de obra"  color={C.blue}/>
        <Kpi label="Indirecto" value={ind}     sub="administración"color={C.purple}/>
      </div>
    </Card>
    {lbFoto&&<Lightbox url={lbFoto} onClose={()=>setLbFoto(null)}/>}
    <Card>
      <Tit>Top subsecciones — avance y evidencia</Tit>
      {top4.map((s,i)=>{
        const fotos=(CATALOGO[s.sec]?.conceptos||[]).flatMap(c=>c.fotos||[]);
        const mostrar=fotos.slice(0,2);
        return <div key={s.sec} style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,gap:6}}>
            <span style={{display:"flex",alignItems:"center",gap:4,minWidth:0,overflow:"hidden"}}>
              <span style={{color:C.textMut,flexShrink:0}}>{i+1}</span>
              <span style={{color:C.caliza,fontWeight:700,flexShrink:0,fontSize:10}}>{s.sec}</span>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.textSec}}>{s.sub}</span>
            </span>
            <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
              <Bdg color={semA(s.a)} small>{s.a}%</Bdg>
              <span style={{fontWeight:600,fontSize:11,color:C.textPri}}>{MXN(s.imp)}</span>
            </div>
          </div>
          <Bar pct={(s.imp/maxI)*100} color="rgba(255,254,249,0.3)"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:7}}>
            {[0,1].map(fi=>{
              const foto=mostrar[fi];
              if(foto)return <div key={fi} style={{borderRadius:6,overflow:"hidden",aspectRatio:"16/9",cursor:"zoom-in"}}
                onClick={()=>setLbFoto(foto.url)}>
                <img src={foto.url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>;
              return <div key={fi} style={{borderRadius:6,aspectRatio:"16/9",
                background:"rgba(255,254,249,0.04)",border:"1px dashed rgba(255,254,249,0.12)",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3}}>
                <span style={{fontSize:16,opacity:0.3}}></span>
                <span style={{fontSize:8,color:C.textMut}}>Sin foto</span>
              </div>;
            })}
          </div>
        </div>;
      })}
      <div style={{fontSize:9,color:C.textMut,textAlign:"center",marginTop:4}}>
        Agrega fotos en Capturar avance → Volúmenes
      </div>
    </Card>
  </div>;
}


// ── BOTÓN GUARDAR AVANCE CON FIRESTORE ────────────────────────────────────
function GuardarAvanceBtn({obra, subs, maquinaria, materiales, onSaved}) {
  const[estado,setEstado]=useState("idle"); // idle | saving | saved | error
  async function guardar() {
    setEstado("saving");
    try {
      await fsSet(`obras/${obra.id}/avance/subs`, {
        data: subs.map(s=>({sec:s.sec,a:s.a})),
        fecha: new Date().toISOString()
      });
      await fsSet(`obras/${obra.id}/avance/maquinaria`, {
        data: maquinaria,
        fecha: new Date().toISOString()
      });
      await fsSet(`obras/${obra.id}/avance/materiales`, {
        data: materiales,
        fecha: new Date().toISOString()
      });
      setEstado("saved");
      if(onSaved) onSaved();
      setTimeout(()=>setEstado("idle"), 3000);
    } catch(e) {
      console.error(e);
      setEstado("error");
      setTimeout(()=>setEstado("idle"), 3000);
    }
  }
  const colors_map = {idle:C.blueDk, saving:C.border, saved:C.greenDk, error:C.redDk};
  const labels_map = {idle:"Guardar registro", saving:"Guardando...", saved:"Guardado", error:"Error al guardar"};
  return (
    <button onClick={guardar} disabled={estado==="saving"}
      style={{background:estado==="idle"?C.blueDk:estado==="saved"?C.greenDk:estado==="error"?C.redDk:C.border,
        border:"none",borderRadius:8,padding:"10px 0",color:"white",
        fontSize:12,fontWeight:500,width:"100%",marginTop:6,letterSpacing:"0.02em",
        cursor:estado==="saving"?"not-allowed":"pointer",transition:"all .3s"}}>
      {labels_map[estado]}
    </button>
  );
}

// ── CAPTURA ────────────────────────────────────────────────────────────────
function Captura({subs,setSubs,maquinaria,setMaquinaria,materiales,setMateriales,rol,obra}){
  const[tab,setTab]=useState("volumenes");
  const[exp,setExp]=useState({});
  const editar=can(rol,"captura","editar");
  const addFoto=(sec,foto)=>setSubs(ss=>ss.map(s=>s.sec===sec?{...s,fotos:{...s.fotos,[sec]:[...(s.fotos[sec]||[]),foto]}}:s));
  const delFoto=(sec,id)=>setSubs(ss=>ss.map(s=>s.sec===sec?{...s,fotos:{...s.fotos,[sec]:(s.fotos[sec]||[]).filter(f=>f.id!==id)}}:s));
  const rMaq=(i,f,v)=>setMaquinaria(mm=>mm.map((m,j)=>{if(j!==i)return m;const u={...m,[f]:v};u.imp=Math.round((parseFloat(u.vol)||0)*(parseFloat(u.pu)||0));return u;}));
  const rMat=(i,f,v)=>setMateriales(mm=>mm.map((m,j)=>{if(j!==i)return m;const u={...m,[f]:v};u.imp=Math.round((parseFloat(u.vol)||0)*(parseFloat(u.pu)||0));return u;}));

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {!editar&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
       Vista de solo lectura — tu rol no tiene permiso para editar este módulo.
    </div>}
    <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0,paddingBottom:1}}>
      {[["volumenes","Volúmenes"],["maquinaria","Maquinaria"],["materiales","Almacén"],["nomina","Nómina"]].map(([id,lbl])=>
        <button key={id} onClick={()=>setTab(id)} style={{flex:"0 0 auto",padding:"7px 14px",fontSize:11,borderRadius:8,
          background:tab===id?C.caliza:C.card,border:`0.5px solid ${tab===id?C.caliza:C.border}`,
          color:tab===id?C.bg:C.textSec,fontWeight:tab===id?700:400,whiteSpace:"nowrap"}}>{lbl}</button>)}
    </div>

    {tab==="volumenes"&&<Card>
      <Tit>Avance por subsección</Tit>
      {subs.map(s=>{
        const nF=(s.fotos[s.sec]||[]).length;
        return <div key={s.sec} style={{background:C.bg,borderRadius:8,padding:"8px 10px",marginBottom:5}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <div style={{flex:1,cursor:"pointer",minWidth:0,overflow:"hidden"}} onClick={()=>setExp(e=>({...e,[s.sec]:!e[s.sec]}))}>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:C.caliza}}>{exp[s.sec]?"▾":"▸"}</span>
                <span style={{fontSize:9,fontWeight:700,color:C.caliza}}>{s.sec}</span>
                <span style={{fontSize:11,color:C.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.sub}</span>
                {nF>0&&<Bdg color={C.purple} small>{nF}</Bdg>}
              </div>
              <div style={{fontSize:9,color:C.textMut,marginTop:1,marginLeft:12}}>{s.n} conceptos · {MXN(s.imp)}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0,marginLeft:8}}>
              {editar?<><input type="number" min="0" max="100" placeholder="0" value={s.a||""}
                onChange={e=>setSubs(ss=>ss.map(x=>x.sec===s.sec?{...x,a:Math.min(100,Math.max(0,parseFloat(e.target.value)||0))}:x))}
                style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:6,
                  padding:"3px 6px",fontSize:12,width:50,textAlign:"right",color:C.textPri,outline:"none"}}/>
              <span style={{fontSize:10,color:C.textMut}}>%</span></>
              :<span style={{fontSize:13,fontWeight:700,color:semA(s.a||0)}}>{s.a||0}%</span>}
            </div>
          </div>
          <Bar pct={s.a||0} color={semA(s.a||0)}/>
          {exp[s.sec]&&<div style={{marginTop:9,borderTop:`0.5px solid ${C.border}`,paddingTop:9}}>
            <div style={{fontSize:9,color:C.textMut,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
              Conceptos — {s.sec} ({(CATALOGO[s.sec]?.conceptos||[]).length} partidas)
            </div>
            {(CATALOGO[s.sec]?.conceptos||[]).map((c,ci)=>(
              <div key={c.clave} style={{background:C.card,borderRadius:7,padding:"8px 10px",marginBottom:5,borderLeft:`2px solid ${semA(c.avance)}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:8,color:C.textMut,marginBottom:2,fontFamily:"monospace"}}>{c.clave}</div>
                    <div style={{fontSize:10,color:C.textSec,lineHeight:1.3}}>{c.desc}</div>
                    <div style={{fontSize:9,color:C.textMut,marginTop:3}}>{c.unidad} · {c.cantidad.toLocaleString("es-MX")} uds</div>
                  </div>
                  <div style={{flexShrink:0,textAlign:"right"}}>
                    <div style={{fontSize:11,fontWeight:600,color:C.textPri}}>{MXN(c.importe)}</div>
                    <div style={{fontSize:8,color:semA(c.avance),marginTop:2,fontWeight:600}}>{c.avance}%</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <div style={{flex:1,background:"rgba(255,254,249,0.08)",borderRadius:99,height:4,overflow:"hidden"}}>
                    <div style={{width:`${c.avance}%`,height:"100%",background:semA(c.avance),borderRadius:99,transition:"width .3s"}}/>
                  </div>
                  {editar&&<><input type="number" min="0" max="100" placeholder="0" value={c.avance||""}
                    onChange={e=>{
                      const val=Math.min(100,Math.max(0,parseFloat(e.target.value)||0));
                      const cat=CATALOGO[s.sec];if(cat)cat.conceptos[ci].avance=val;
                      const conceptos=CATALOGO[s.sec]?.conceptos||[];
                      const totalImp=conceptos.reduce((t,x)=>t+x.importe,0);
                      const avSub=totalImp>0?conceptos.reduce((t,x)=>t+(x.avance/100)*x.importe,0)/totalImp*100:0;
                      setSubs(ss=>ss.map(x=>x.sec===s.sec?{...x,a:Math.round(avSub*10)/10}:x));
                    }}
                    style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:5,
                      padding:"2px 5px",fontSize:11,width:44,textAlign:"right",color:C.textPri,outline:"none"}}/>
                  <span style={{fontSize:9,color:C.textMut}}>%</span></>}
                </div>
                {editar&&<ConceptoFotos fotos={c.fotos}
                  onAdd={foto=>{const cat=CATALOGO[s.sec];if(cat){cat.conceptos[ci].fotos=[...cat.conceptos[ci].fotos,foto];}setSubs(ss=>[...ss]);}}
                  onDel={id=>{const cat=CATALOGO[s.sec];if(cat){cat.conceptos[ci].fotos=cat.conceptos[ci].fotos.filter(f=>f.id!==id);}setSubs(ss=>[...ss]);}}/>}
              </div>
            ))}
          </div>}
        </div>;
      })}
    </Card>}

    {tab==="maquinaria"&&<Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Tit>Maquinaria propia en obra</Tit>
        <span style={{fontSize:9,color:C.textMut}}>Suma al gasto</span>
      </div>
      {maquinaria.map((m,i)=><div key={m.id} style={{background:C.bg,borderRadius:7,padding:"8px 10px",marginBottom:5}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          <span style={{fontSize:10,color:C.textMut,width:18,textAlign:"center",flexShrink:0}}>{i+1}</span>
          {editar?<Inp placeholder="Descripción..." value={m.desc} style={{flex:1,fontSize:10}}
            onChange={e=>setMaquinaria(mm=>mm.map((x,j)=>j===i?{...x,desc:e.target.value}:x))}/>
          :<span style={{flex:1,fontSize:10,color:C.textSec}}>{m.desc||"—"}</span>}
          {editar&&<button onClick={()=>setMaquinaria(mm=>mm.filter((_,j)=>j!==i))}
            style={{background:"none",border:"none",color:C.red,fontSize:14,lineHeight:1,flexShrink:0}}>×</button>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
          {[["Volumen","number",m.vol,"vol"],["Unidad","text",m.und,"und"],["P.U.","number",m.pu,"pu"]].map(([l,type,val,field])=>
            <div key={l}>
              <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>{l}</div>
              {editar?<Inp type={type} min="0" placeholder={type==="number"?"0":"Mes"} value={val}
                style={{textAlign:type==="number"?"right":"left",fontSize:11}}
                onChange={e=>rMaq(i,field,e.target.value)}/>
              :<div style={{fontSize:11,color:C.textSec,padding:"5px 0"}}>{val||"—"}</div>}
            </div>)}
          <div>
            <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Importe</div>
            <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,
              padding:"5px 7px",fontSize:12,fontWeight:700,color:C.orange,textAlign:"right"}}>{MXN(m.imp)}</div>
          </div>
        </div>
      </div>)}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`}}>
        {editar&&<SecBtn onClick={()=>setMaquinaria(mm=>[...mm,{id:Date.now(),desc:"",vol:"",und:"Mes",pu:"",imp:0}])}>+ Agregar</SecBtn>}
        <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginLeft:"auto"}}>
          Total: <span style={{color:C.orange}}>{MXN(maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0))}</span>
        </div>
      </div>
    </Card>}

    {tab==="materiales"&&<Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Tit>Materiales en almacén</Tit>
        <span style={{fontSize:9,color:C.textMut}}>Suma al monto ejecutado</span>
      </div>
      {materiales.map((m,i)=>{
        const cc=m.concepto||"En almacén";
        return <div key={m.id} style={{background:C.bg,borderRadius:7,padding:"8px 10px",marginBottom:5,borderLeft:`2px solid ${CT_COL[cc]}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontSize:10,color:C.textMut,width:18,textAlign:"center",flexShrink:0}}>{i+1}</span>
            {editar?<Inp placeholder="Descripción..." value={m.desc} style={{flex:1,fontSize:10}}
              onChange={e=>setMateriales(mm=>mm.map((x,j)=>j===i?{...x,desc:e.target.value}:x))}/>
            :<span style={{flex:1,fontSize:10,color:C.textSec}}>{m.desc||"—"}</span>}
            {editar?<Sel value={cc} style={{fontSize:10,padding:"5px 6px",flexShrink:0,width:110}}
              onChange={e=>setMateriales(mm=>mm.map((x,j)=>j===i?{...x,concepto:e.target.value}:x))}>
              {CPTS.map(c=><option key={c} value={c}>{c}</option>)}
            </Sel>:<Bdg color={CT_COL[cc]} small>{cc}</Bdg>}
            {editar&&<button onClick={()=>setMateriales(mm=>mm.filter((_,j)=>j!==i))}
              style={{background:"none",border:"none",color:C.red,fontSize:14,lineHeight:1,flexShrink:0}}>×</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
            {[["Volumen","number",m.vol,"vol"],["Unidad","text",m.und,"und"],["P.U.","number",m.pu,"pu"]].map(([l,type,val,field])=>
              <div key={l}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>{l}</div>
                {editar?<Inp type={type} min="0" placeholder="0" value={val}
                  style={{textAlign:type==="number"?"right":"left",fontSize:11}}
                  onChange={e=>rMat(i,field,e.target.value)}/>
                :<div style={{fontSize:11,color:C.textSec,padding:"5px 0"}}>{val||"—"}</div>}
              </div>)}
            <div>
              <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Importe</div>
              <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,
                padding:"5px 7px",fontSize:12,fontWeight:700,color:CT_COL[cc]||C.blue,textAlign:"right"}}>{MXN(m.imp)}</div>
            </div>
          </div>
        </div>;
      })}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`}}>
        {editar&&<SecBtn onClick={()=>setMateriales(mm=>[...mm,{id:Date.now(),desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0}])}>+ Agregar</SecBtn>}
        <div style={{fontSize:12,fontWeight:600,color:C.textPri,marginLeft:"auto"}}>
          Total: <span style={{color:C.blue}}>{MXN(materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0),0))}</span>
        </div>
      </div>
    </Card>}


    {tab==="nomina"&&obra&&<Nomina obra={obra} rol={rol}/>}

    {tab!=="nomina"&&editar&&<GuardarAvanceBtn obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales} onSaved={()=>setCambiosPendientes(false)}/>}
  </div>;
}

// ── GASTOS GP ──────────────────────────────────────────────────────────────
function GastosGP({obra,maquinaria,rol}){
  const[idx,setIdx]=useState(7);
  const cur=PERIODOS[idx]; const prev=idx>0?PERIODOS[idx-1]:null;
  const delta=prev?cur.a-prev.a:cur.a;
  const maxD=Math.max(...PERIODOS.map((_,i)=>i>0?PERIODOS[i].a-PERIODOS[i-1].a:PERIODOS[0].a));
  const totalGP=RUBROS_GP.reduce((t,r)=>t+r.monto,0);
  const totalMaq=maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
      <Kpi label="Gasto GP Construct" value={MXN(totalGP)}   sub="acumulado GP"  color={C.red}    size={12}/>
      <Kpi label="Maquinaria propia"  value={MXN(totalMaq)}  sub="equipo FOSMON" color={C.orange} size={12}/>
      <Kpi label="Gasto total obra"   value={MXN(totalGP+totalMaq)} sub="GP+maquinaria" color={C.textPri} size={12}/>
      <Kpi label="% del presupuesto"  value={`${NUM((totalGP+totalMaq)/obra.presupuesto*100,1)}%`} sub="del contrato" color={C.yellow}/>
    </div>
    <Card>
      <Tit>Desglose acumulado por rubro</Tit>
      {RUBROS_GP.map(r=>{
        const pctGP=totalGP>0?r.monto/totalGP*100:0;
        return <div key={r.id} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:6}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:r.color,flexShrink:0}}/>
              <span style={{fontSize:11,color:C.textSec}}>{r.label}</span>
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
              <span style={{fontSize:9,color:C.textMut}}>{NUM(pctGP,1)}% del GP</span>
              <span style={{fontSize:12,fontWeight:600,color:r.color}}>{MXN(r.monto)}</span>
            </div>
          </div>
          <Bar pct={pctGP} color={r.color}/>
        </div>;
      })}
      <div style={{marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`,
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:10,color:C.textMut}}>TOTAL GASTO ACUMULADO</span>
        <span style={{fontSize:14,fontWeight:700,color:C.textPri}}>{MXN(totalGP+totalMaq)}</span>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <Tit>Evolución acumulada — GP Construct</Tit>
        <span style={{fontSize:9,color:C.caliza,fontWeight:600}}>Act: {obra.ultimaAct}</span>
      </div>
      <input type="range" min="0" max={PERIODOS.length-1} value={idx} step="1"
        style={{marginBottom:5}} onChange={e=>setIdx(parseInt(e.target.value))}/>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        {PERIODOS.map((p,i)=><span key={p.k} onClick={()=>setIdx(i)} style={{fontSize:8,cursor:"pointer",
          color:i===idx?C.caliza:"rgba(255,254,249,0.3)",fontWeight:i===idx?600:400}}>{p.l}</span>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:10}}>
        {[[`Acum. al ${cur.l}`,MXN(cur.a),C.red],["Gasto período",MXN(delta),C.caliza],
          ["% del total GP",`${NUM(cur.a/totalGP*100,1)}%`,C.purple]].map(([l,v,c])=>
          <div key={l} style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${c}`}}>
            <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>{l}</div>
            <div style={{fontSize:14,fontWeight:600,color:c}}>{v}</div>
          </div>)}
      </div>
      {PERIODOS.map((p,i)=>{
        const d=i>0?p.a-PERIODOS[i-1].a:p.a;
        return <div key={p.k} style={{marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3,gap:6}}>
            <span style={{color:i===idx?C.caliza:"rgba(255,254,249,0.5)",fontWeight:i===idx?600:400}}>{p.l}</span>
            <span style={{fontWeight:600,color:C.caliza}}>{MXN(d)}</span>
          </div>
          <Bar pct={d/maxD*100} color={i===idx?C.caliza:"rgba(255,254,249,0.2)"}/>
        </div>;
      })}
    </Card>
  </div>;
}

// ── ESTIMACIONES ───────────────────────────────────────────────────────────
function Estimaciones({obra,setObra,estimaciones,setEstimaciones,rol}){
  const[saved,setSaved]=useState(false);
  const editar=can(rol,"estimaciones","editar");
  const ESTATUS=["En proceso","Aprobada","Facturada","Pagada"];
  const cE=e=>{const a=e.monto*obra.pctAnticipo/100,fg=e.monto*obra.pctFondoGar/100,re=e.monto*(obra.pctRetencion||0)/100;return{a,fg,re,ef:e.monto-a-fg-re,pC:e.monto/obra.presupuesto*100};};
  const totalEst  =estimaciones.reduce((t,e)=>t+e.monto,0);
  const pagado    =estimaciones.filter(e=>e.estatus==="Pagada").reduce((t,e)=>t+cE(e).ef,0);
  const facturado =estimaciones.filter(e=>e.estatus==="Facturada").reduce((t,e)=>t+e.monto,0);
  const enProceso =estimaciones.filter(e=>e.estatus==="En proceso").reduce((t,e)=>t+e.monto,0);
  const retenido  =estimaciones.reduce((t,e)=>t+cE(e).fg,0);
  const retenEstra=estimaciones.reduce((t,e)=>t+cE(e).re,0);
  const porAmort  =estimaciones.filter(e=>e.estatus!=="Pagada").reduce((t,e)=>t+cE(e).a,0);
  const porEstimar=obra.presupuesto-totalEst;
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {!editar&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
       Vista de solo lectura — tu rol no permite editar estimaciones.
    </div>}
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <Tit>Configuración del contrato</Tit>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["Anticipo",obra.pctAnticipo,v=>{const upd={...obra,pctAnticipo:parseFloat(v)||0};setObra(upd);fsSet(`obras/${obra.id}/config/parametros`,{pctAnticipo:upd.pctAnticipo,pctFondoGar:upd.pctFondoGar,pctRetencion:upd.pctRetencion||0});}],
            ["Fondo garantía",obra.pctFondoGar,v=>{const upd={...obra,pctFondoGar:parseFloat(v)||0};setObra(upd);fsSet(`obras/${obra.id}/config/parametros`,{pctAnticipo:upd.pctAnticipo,pctFondoGar:upd.pctFondoGar,pctRetencion:upd.pctRetencion||0});}],
            ["Ret. estratégica",obra.pctRetencion||0,v=>{const upd={...obra,pctRetencion:parseFloat(v)||0};setObra(upd);fsSet(`obras/${obra.id}/config/parametros`,{pctAnticipo:upd.pctAnticipo,pctFondoGar:upd.pctFondoGar,pctRetencion:upd.pctRetencion||0});}]].map(([l,v,s])=>
            <div key={l} style={{display:"flex",alignItems:"center",gap:6,background:C.bg,borderRadius:6,padding:"5px 10px",border:`0.5px solid ${C.border}`}}>
              <span style={{fontSize:10,color:C.textMut}}>{l}</span>
              {editar?<input type="number" min="0" max="100" value={v} onChange={e=>s(e.target.value)}
                style={{background:"transparent",border:`0.5px solid ${C.borderM}`,borderRadius:4,
                  padding:"3px 5px",color:C.textPri,fontSize:11,width:38,textAlign:"right",outline:"none"}}/>
              :<span style={{fontSize:12,fontWeight:700,color:C.textPri,minWidth:28}}>{v}%</span>}
              <span style={{fontSize:10,color:C.textMut}}>%</span>
            </div>)}
        </div>
      </div>
    </Card>
    <Card>
      <Tit>Resumen económico — 8 indicadores</Tit>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:7}}>
        <Kpi label="Total estimado"    value={MXN(totalEst)}    sub={`${NUM(totalEst/obra.presupuesto*100,1)}% contrato`} color={C.caliza} size={12}/>
        <Kpi label="Pagado"            value={MXN(pagado)}      sub="cobrado"            color={C.green}  size={12}/>
        <Kpi label="Facturado"         value={MXN(facturado)}   sub="pendiente de cobro" color={C.purple} size={12}/>
        <Kpi label="En proceso"        value={MXN(enProceso)}   sub="en elaboración"     color={C.yellow} size={12}/>
        <Kpi label="Retenido FG"       value={MXN(retenido)}    sub={`fondo ${obra.pctFondoGar}%`}          color={C.red}    size={12}/>
        <Kpi label="Ret. estratégica"  value={MXN(retenEstra)}  sub={`retención ${obra.pctRetencion||0}%`}  color={C.pink}   size={12}/>
        <Kpi label="Por recuperar ant."value={MXN(porAmort)}    sub={`anticipo ${obra.pctAnticipo}%`}       color={C.orange} size={12}/>
        <Kpi label="Por estimar"       value={MXN(porEstimar)}  sub="saldo del contrato" color={C.indigo} size={12}/>
      </div>
    </Card>
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <Tit>Relación de estimaciones</Tit>
        <div style={{display:"flex",gap:6}}>
        {editar&&<SecBtn onClick={()=>setEstimaciones(es=>[...es,{no:(es.length>0?Math.max(...es.map(e=>e.no)):0)+1,monto:0,periodo:"",estatus:"En proceso"}])}>+ Nueva estimación</SecBtn>}
        {editar&&<button onClick={()=>{
          try{
            fsSet(`obras/${obra.id}/config/estimaciones`, {data:estimaciones});
            fsSet(`obras/${obra.id}/config/parametros`, {pctAnticipo:obra.pctAnticipo,pctFondoGar:obra.pctFondoGar,pctRetencion:obra.pctRetencion||0});
            setSaved(true); setTimeout(()=>setSaved(false),2500);
          }catch(e){alert("Error al guardar");}
        }} style={{background:saved?C.green:C.caliza,border:"none",borderRadius:6,
          padding:"5px 14px",fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer",
          transition:"background .3s",display:"flex",alignItems:"center",gap:5}}>
          {saved?"Guardado":"Guardar cambios"}
        </button>}
      </div>
      </div>
      {estimaciones.map((e,i)=>{
        const c=cE(e); const ecol=EST_COL[e.estatus]||C.yellow;
        return <div key={e.no} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,borderLeft:`3px solid ${ecol}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8}}>
            <span style={{fontSize:13,fontWeight:700,color:C.caliza,letterSpacing:"0.06em"}}>EST-0{e.no}</span>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {editar?<Sel value={e.estatus} style={{fontSize:10,padding:"4px 6px"}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,estatus:ev.target.value}:x))}>
                {ESTATUS.map(s=><option key={s} value={s}>{s}</option>)}
              </Sel>:<Bdg color={ecol}>{e.estatus}</Bdg>}
              <Bdg color={ecol} small>{e.estatus}</Bdg>
              {editar&&<button onClick={()=>setEstimaciones(es=>es.filter((_,j)=>j!==i))}
                style={{background:"none",border:"none",color:C.red,fontSize:14,lineHeight:1}}>×</button>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Monto bruto</div>
              {editar?<Inp type="number" value={e.monto} style={{fontSize:12,fontWeight:600,color:C.caliza}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,monto:parseFloat(ev.target.value)||0}:x))}/>
              :<div style={{fontSize:14,fontWeight:700,color:C.caliza}}>{MXN(e.monto)}</div>}
            </div>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Período</div>
              {editar?<Inp type="text" value={e.periodo||""} placeholder="01–31 May 2026" style={{fontSize:11}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,periodo:ev.target.value}:x))}/>
              :<div style={{fontSize:12,color:C.textSec,padding:"5px 0"}}>{e.periodo||"—"}</div>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
            {[[`Anticip. (${obra.pctAnticipo}%)`,MXN(c.a),C.yellow],[`FG (${obra.pctFondoGar}%)`,MXN(c.fg),C.red],
              [`Ret. (${obra.pctRetencion||0}%)`,MXN(c.re),C.pink],
              ["Monto efectivo",MXN(c.ef),C.green],["% contrato",`${NUM(c.pC,2)}%`,C.caliza]].map(([l,v,col])=>
              <div key={l}>
                <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>{l}</div>
                <div style={{background:C.card,border:`0.5px solid ${C.border}`,borderRadius:6,
                  padding:"5px 8px",fontSize:12,fontWeight:600,color:col}}>{v}</div>
              </div>)}
          </div>
        </div>;
      })}
    </Card>
  </div>;
}

// ── RIESGO ─────────────────────────────────────────────────────────────────
function Riesgo({obra,subs,maquinaria,materiales,estimaciones}){
  const gt=obra.gastoGP+maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const am=subs.reduce((t,s)=>t+(s.a/100)*s.imp,0);
  const me=am+materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0),0);
  const af=subs.reduce((t,s)=>t+(s.a/100)*(s.imp/obra.presupuesto)*100,0);
  const pctGasto=gt/obra.presupuesto*100;
  const brecha=pctGasto-af;
  const pctPlazo=19.6;
  const burnRate=pctGasto/pctPlazo;
  const totalEst=estimaciones.reduce((t,e)=>t+e.monto,0);
  const sinCobrar=estimaciones.filter(e=>e.estatus==="Facturada"||e.estatus==="En proceso").reduce((t,e)=>t+e.monto,0);
  const pctSinCob=totalEst>0?sinCobrar/totalEst*100:0;
  const sinIniciar=subs.filter(s=>s.a===0);
  const PROVS=[{p:"FOSMON CONSTRUCCIONES S.A.",gt:4280794},{p:"JUAN ANTONIO BENITEZ F.",gt:2412104},
    {p:"CEMEX S A B DE C V",gt:1817638},{p:"IMSS",gt:1636496},{p:"JOSE E. ALEGRIA CUETO",gt:1426787},
    {p:"RAUL CUEVAS TORRES",gt:1407121},{p:"MATERIALES RABAN DE OAXACA",gt:1038214},{p:"CONSTRUCCIONES KAYT",gt:998185}];
  const totProv=PROVS.reduce((t,p)=>t+p.gt,0);
  const top3pct=PROVS.slice(0,3).reduce((t,p)=>t+p.gt,0)/totProv*100;

  // ── NÓMINA RISK ─────────────────────────────────────────────────────────
  // Total nómina S18
  const totalNom=NOMINA_S18.reduce((t,p)=>t+p.total,0);
  const totalHE=NOMINA_S18.reduce((t,p)=>t+p.importeHE,0);
  const pctHE=totalNom>0?totalHE/totalNom*100:0;
  // Personas con HE > 20 hrs (riesgo fatiga/costo)
  const altasHE=NOMINA_S18.filter(p=>p.horasExtra>=20);
  // Personas con salario total > 2x su salario base (posible error o caso especial)
  const anomalias=NOMINA_S18.filter(p=>p.total>p.salarioSemanal*2.5&&p.salarioSemanal>0);
  // Semana simulada anterior (S17) — reducción del 15% para comparar
  const nomS17_total=totalNom*0.87;
  const deltaNom=totalNom-nomS17_total;
  const pctDeltaNom=nomS17_total>0?deltaNom/nomS17_total*100:0;

  const indicadores=[
    {num:1,titulo:"Brecha avance vs gasto",color:brecha<5?C.green:brecha<15?C.yellow:C.red,
     valor:`${brecha>=0?"+":""}${NUM(brecha,1)}pp`,
     detalle:brecha<5?"Avance y gasto alineados":brecha<15?"Gasto ligeramente adelantado al avance":"Gasto supera avance — riesgo de sobrecosto",
     extra:`Avance físico: ${NUM(af,1)}% | Gasto consumido: ${NUM(pctGasto,1)}% del presupuesto`},
    {num:2,titulo:"Velocidad de quema de presupuesto",color:burnRate<0.9?C.green:burnRate<1.2?C.yellow:C.red,
     valor:`${NUM(burnRate,2)}x`,
     detalle:burnRate<0.9?"Ritmo de gasto dentro del programa":burnRate<1.2?"Ritmo ligeramente acelerado":"Ritmo de gasto excede el programa",
     extra:`${NUM(pctPlazo,0)}% del plazo transcurrido | ${NUM(pctGasto,1)}% del presupuesto gastado`},
    {num:3,titulo:"Estimaciones pendientes de cobro",color:pctSinCob<30?C.green:pctSinCob<60?C.yellow:C.red,
     valor:`${NUM(pctSinCob,0)}%`,
     detalle:pctSinCob<30?"Flujo de cobro saludable":pctSinCob<60?"Monto significativo pendiente":"Más del 60% sin cobrar — riesgo de flujo",
     extra:`${MXN(sinCobrar)} sin cobrar de ${MXN(totalEst)} estimados`},
    {num:4,titulo:"Frentes sin iniciar",color:sinIniciar.length===0?C.green:sinIniciar.length<=2?C.yellow:C.red,
     valor:String(sinIniciar.length),
     detalle:sinIniciar.length===0?"Todos los frentes han iniciado":`${sinIniciar.length} subsección(es) con avance = 0%`,
     extra:sinIniciar.length>0?`Sin iniciar: ${sinIniciar.map(s=>s.sec).join(", ")}`:"Todos los frentes activos"},
    {num:5,titulo:"Concentración de proveedores",color:top3pct<40?C.green:top3pct<55?C.yellow:C.red,
     valor:`${NUM(top3pct,0)}%`,
     detalle:top3pct<40?"Bien diversificado":top3pct<55?"Concentración moderada — monitorear":"Concentración alta — diversificar",
     extra:`Top 3 proveedores = ${NUM(top3pct,1)}% del gasto registrado`},
    {num:6,titulo:"Incremento de nómina semana sobre semana",color:pctDeltaNom<5?C.green:pctDeltaNom<15?C.yellow:C.red,
     valor:`+${NUM(pctDeltaNom,1)}%`,
     detalle:pctDeltaNom<5?"Nómina estable entre semanas":pctDeltaNom<15?"Incremento moderado — revisar horas extra":"Incremento alto — verificar altas y horas extraordinarias",
     extra:`S17: ${MXN(nomS17_total)} → S18: ${MXN(totalNom)} | Incremento: ${MXN(deltaNom)}`},
    {num:7,titulo:"Trabajadores con horas extra excesivas (≥20hrs)",color:altasHE.length===0?C.green:altasHE.length<=5?C.yellow:C.red,
     valor:String(altasHE.length),
     detalle:altasHE.length===0?"Sin casos de horas extra excesivas":altasHE.length<=5?"Casos moderados — monitorear fatiga y costo":"Múltiples trabajadores con HE excesivas — revisar organización de turnos",
     extra:altasHE.slice(0,3).map(p=>`${p.nombre.split(" ")[0]}: ${p.horasExtra}hrs`).join(" · ")+(altasHE.length>3?` · y ${altasHE.length-3} más`:"")},
  ];

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {indicadores.map(ind=>
      <Card key={ind.num} accent={ind.color}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:9,color:C.textMut,flexShrink:0}}>RIESGO {ind.num}</span>
              <span style={{fontSize:11,fontWeight:600,color:C.textPri}}>{ind.titulo}</span>
            </div>
            <div style={{fontSize:10,color:C.textSec,marginBottom:5}}>{ind.detalle}</div>
            <div style={{fontSize:9,color:C.textMut,lineHeight:1.5}}>{ind.extra}</div>
          </div>
          <div style={{flexShrink:0,textAlign:"right"}}>
            <div style={{fontSize:22,fontWeight:700,color:ind.color,lineHeight:1}}>{ind.valor}</div>
            <div style={{fontSize:8,color:ind.color,marginTop:3,fontWeight:600,textTransform:"uppercase"}}>
              {ind.color===C.green?"Normal":ind.color===C.yellow?"Vigilancia":"Crítico"}
            </div>
          </div>
        </div>
        <div style={{height:4,borderRadius:99,background:"rgba(255,254,249,0.08)",overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:99,background:ind.color,
            width:ind.color===C.green?"33%":ind.color===C.yellow?"66%":"100%",transition:"width .4s"}}/>
        </div>
      </Card>)}

    {/* Detalle nómina */}
    <Card>
      <Tit>Detalle de nómina — Top 10 por costo total S18</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6,marginBottom:6,
        padding:"0 4px 6px",borderBottom:`0.5px solid ${C.border}`}}>
        {["Trabajador","HE hrs","Tipo","Total"].map(h=>
          <div key={h} style={{fontSize:9,color:C.textMut,fontWeight:600}}>{h}</div>)}
      </div>
      {NOMINA_S18.slice().sort((a,b)=>b.total-a.total).slice(0,10).map((p,i)=>
        <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:6,
          marginBottom:5,alignItems:"center"}}>
          <div>
            <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
            <div style={{fontSize:9,color:C.textMut}}>{p.categoria}</div>
          </div>
          <div style={{fontSize:11,fontWeight:600,color:p.horasExtra>=20?C.red:p.horasExtra>0?C.orange:C.textMut,textAlign:"center"}}>
            {p.horasExtra>0?`${p.horasExtra}hrs`:"—"}
          </div>
          <Bdg color={p.tipo==="D"?C.blue:C.purple} small>{p.tipo==="D"?"D":"I"}</Bdg>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textPri}}>{MXN(p.total)}</div>
            {p.importeHE>0&&<div style={{fontSize:8,color:C.orange}}>+{MXN(p.importeHE)}</div>}
          </div>
        </div>)}
    </Card>

    <Card>
      <Tit>Top proveedores — concentración</Tit>
      {PROVS.map((pv,i)=><div key={pv.p} style={{marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,fontSize:11,gap:6}}>
          <span style={{display:"flex",alignItems:"center",gap:5,minWidth:0,overflow:"hidden"}}>
            <span style={{color:C.textMut,flexShrink:0}}>{i+1}</span>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.textSec}}>{pv.p}</span>
          </span>
          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <span style={{fontSize:9,color:C.textMut}}>{NUM(pv.gt/totProv*100,1)}%</span>
            <span style={{fontWeight:600,fontSize:11,color:C.textPri}}>{MXN(pv.gt)}</span>
          </div>
        </div>
        <Bar pct={pv.gt/PROVS[0].gt*100} color={i<3?C.red:`${C.red}55`}/>
      </div>)}
    </Card>
  </div>;
}

// ── APP PRINCIPAL ──────────────────────────────────────────────────────────

// ── CARGA DE PRESUPUESTO / CATÁLOGO ────────────────────────────────────────
// Parser inteligente: detecta columnas por patrón, no por posición fija
function parsearPresupuesto(data, importeContrato) {
  // data = array de arrays (filas del Excel)
  // Filtrar filas vacías
  const filas = data.filter(row => row.some(c => c !== null && c !== undefined && String(c).trim() !== ''));

  // Detectar qué columna es qué por heurística
  // Clave: texto corto alfanumérico con guiones (ej: 0219-OAX-CBH-08)
  // Descripción: texto largo (> 20 chars promedio)
  // Unidad: texto muy corto (M2, ML, PZA, M3, etc.)
  // Volumen/Cantidad: número decimal positivo pequeño-mediano
  // PU: número decimal positivo, puede ser grande
  // Importe: número decimal positivo grande (generalmente mayor que PU)

  // Encontrar fila de headers (primera fila con texto en ≥3 columnas)
  let headerRow = 0;
  let dataStart = 0;
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const textCols = filas[i].filter(c => c && isNaN(Number(c)) && String(c).trim().length > 1).length;
    if (textCols >= 3) { headerRow = i; dataStart = i + 1; break; }
  }

  const nCols = filas[0]?.length || 0;

  // Analizar columnas en las filas de datos
  const colStats = Array.from({length: nCols}, () => ({
    numCount: 0, textCount: 0, shortTextCount: 0, longTextCount: 0,
    codeCount: 0, avgNum: 0, maxNum: 0, nums: []
  }));

  const dataRows = filas.slice(dataStart);
  dataRows.forEach(row => {
    row.forEach((cell, ci) => {
      if (ci >= nCols) return;
      const s = String(cell || '').trim();
      if (!s) return;
      const n = Number(s.replace(/[$,]/g, ''));
      if (!isNaN(n) && n !== 0) {
        colStats[ci].numCount++;
        colStats[ci].nums.push(Math.abs(n));
        colStats[ci].maxNum = Math.max(colStats[ci].maxNum, Math.abs(n));
      } else {
        colStats[ci].textCount++;
        if (s.length <= 6) colStats[ci].shortTextCount++;
        if (s.length > 15) colStats[ci].longTextCount++;
        // Patrón de clave: tiene guiones y números mezclados
        if (/[A-Z0-9].*-.*[A-Z0-9]/.test(s) || /^\d{4}/.test(s)) colStats[ci].codeCount++;
      }
    });
  });

  // Calcular promedios
  colStats.forEach(cs => {
    if (cs.nums.length > 0) cs.avgNum = cs.nums.reduce((a,b)=>a+b,0) / cs.nums.length;
  });

  // Asignar roles a columnas
  let colClave=-1, colDesc=-1, colUnidad=-1, colCantidad=-1, colPU=-1, colImporte=-1;

  // Clave: mayor proporción de códigos alfanuméricos
  let maxCode = 0;
  colStats.forEach((cs, ci) => {
    if (cs.codeCount > maxCode && cs.textCount > dataRows.length * 0.1) {
      maxCode = cs.codeCount; colClave = ci;
    }
  });

  // Descripción: mayor proporción de texto largo
  let maxLong = 0;
  colStats.forEach((cs, ci) => {
    if (ci === colClave) return;
    if (cs.longTextCount > maxLong) { maxLong = cs.longTextCount; colDesc = ci; }
  });

  // Entre columnas numéricas, ordenar por avgNum DESC
  const numCols = colStats.map((cs, ci) => ({ci, ...cs}))
    .filter(cs => cs.numCount > dataRows.length * 0.05 && cs.ci !== colClave && cs.ci !== colDesc)
    .sort((a,b) => b.avgNum - a.avgNum);

  // Importe: mayor promedio numérico
  if (numCols.length > 0) colImporte = numCols[0].ci;
  // PU: segundo mayor promedio
  if (numCols.length > 1) colPU = numCols[1].ci;
  // Cantidad: tercer mayor (o menor promedio)
  if (numCols.length > 2) colCantidad = numCols[numCols.length-1].ci;

  // Unidad: texto muy corto que no es clave ni descripción
  colStats.forEach((cs, ci) => {
    if (ci === colClave || ci === colDesc || ci === colImporte || ci === colPU || ci === colCantidad) return;
    if (cs.shortTextCount > cs.textCount * 0.5 && cs.textCount > 3) colUnidad = ci;
  });

  // Parsear conceptos
  const conceptos = [];
  let totalLeido = 0;

  dataRows.forEach((row, ri) => {
    const clave   = colClave   >= 0 ? String(row[colClave]   || '').trim() : '';
    const desc    = colDesc    >= 0 ? String(row[colDesc]    || '').trim() : '';
    const unidad  = colUnidad  >= 0 ? String(row[colUnidad]  || '').trim() : '';
    const cant    = colCantidad >= 0 ? parseFloat(String(row[colCantidad] || '').replace(/[$,]/g,'')) || 0 : 0;
    const pu      = colPU      >= 0 ? parseFloat(String(row[colPU]      || '').replace(/[$,]/g,'')) || 0 : 0;
    const importe = colImporte >= 0 ? Math.abs(parseFloat(String(row[colImporte] || '').replace(/[$,]/g,'')) || 0) : 0;

    // Filtrar filas sin datos útiles
    if (!desc && !clave) return;
    if (importe === 0 && pu === 0 && cant === 0) return;
    // Filtrar subtotales/totales
    if (/^total/i.test(desc) || /^subtotal/i.test(desc)) return;

    totalLeido += importe;
    const pctContrato = importeContrato > 0 ? (importe / importeContrato * 100) : 0;
    conceptos.push({
      id: String(ri),
      clave: clave || `C${ri+1}`,
      desc: desc || '(sin descripción)',
      unidad, cant, pu, importe,
      pctContrato: Math.round(pctContrato * 100) / 100,
      avance: 0, fotos: []
    });
  });

  return {
    conceptos,
    totalLeido,
    colsDetectadas: {colClave, colDesc, colUnidad, colCantidad, colPU, colImporte},
    nFilasLeidas: dataRows.length,
  };
}

function Presupuesto({obra, setObra, rol}) {
  // Cargar SheetJS dinámicamente
  useEffect(() => {
    if (typeof window.XLSX === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      document.head.appendChild(s);
    }
  }, []);
  const [fase, setFase] = useState('inicio'); // inicio | revisando | confirmado
  const [importeContrato, setImporteContrato] = useState(obra.presupuesto || 0);
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('');
  const [paginaActual, setPaginaActual] = useState(0);
  const POR_PAG = 20;
  const fileRef = useRef();
  const editar = can(rol, 'captura', 'editar');

  // Cargar catálogo desde Firestore
  const [catalogoGuardado, setCatalogoGuardado] = useState(null);
  useEffect(()=>{
    fsGet(`obras/${obra.id}/config/catalogo`).then(d=>{
      if(d) setCatalogoGuardado(d);
    });
  },[obra.id]);

  function procesarArchivo(file) {
    if (!file) return;
    setCargando(true); setError('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        // Parsear Excel con SheetJS (cargado via CDN en el HTML)
        // Como no tenemos SheetJS aquí, simulamos con CSV parsing para .csv
        // Para .xlsx necesitamos SheetJS
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
          const text = new TextDecoder().decode(e.target.result);
          const rows = text.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g,'')));
          const res = parsearPresupuesto(rows, importeContrato);
          setResultado(res); setFase('revisando');
        } else {
          // xlsx: usar SheetJS que se carga dinámicamente
          const wb = window.XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
          const res = parsearPresupuesto(rows, importeContrato);
          setResultado(res); setFase('revisando');
        }
      } catch(err) {
        setError('Error al leer el archivo: ' + err.message);
      }
      setCargando(false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function confirmarCatalogo() {
    if (!resultado) return;
    const cat = {
      obraId: obra.id,
      importeContrato,
      totalLeido: resultado.totalLeido,
      conceptos: resultado.conceptos,
      fechaCarga: new Date().toLocaleDateString('es-MX'),
      archivo: 'Presupuesto cargado'
    };
    try {
      await fsSet(`obras/${obra.id}/config/catalogo`, cat);
      setObra({...obra, presupuesto: importeContrato});
    } catch(e) { setError('Error al guardar: ' + e.message); return; }
    setCatalogoGuardado(cat);
    setFase('confirmado');
  }

  const difTotal = resultado ? Math.abs(importeContrato - resultado.totalLeido) : 0;
  const pctLeido = importeContrato > 0 && resultado ? (resultado.totalLeido / importeContrato * 100) : 0;
  const conceptosFiltrados = resultado?.conceptos.filter(c =>
    !filtro || c.clave.toLowerCase().includes(filtro.toLowerCase()) ||
    c.desc.toLowerCase().includes(filtro.toLowerCase())
  ) || [];
  const paginas = Math.ceil(conceptosFiltrados.length / POR_PAG);
  const conceptosPagina = conceptosFiltrados.slice(paginaActual * POR_PAG, (paginaActual+1) * POR_PAG);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
    

      <Card>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <Tit> Catálogo de presupuesto — {obra.nombre}</Tit>
          {catalogoGuardado && fase==='inicio' && (
            <Bdg color={C.green}>Cargado el {catalogoGuardado.fechaCarga}</Bdg>
          )}
        </div>
        <div style={{fontSize:10,color:C.textMut}}>
          El presupuesto se carga una única vez por obra. Define las partidas con las que se medirá el avance físico.
        </div>
      </Card>

      {/* CATÁLOGO YA CARGADO — resumen */}
      {catalogoGuardado && fase==='inicio' && (
        <Card>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:12}}>
            <Kpi label="Conceptos" value={catalogoGuardado.conceptos.length} sub="partidas en catálogo" color={C.blue}/>
            <Kpi label="Total contrato" value={MXN(catalogoGuardado.importeContrato)} sub="capturado manualmente" color={C.caliza} size={12}/>
            <Kpi label="Total leído" value={MXN(catalogoGuardado.totalLeido)} sub="suma del archivo" color={C.green} size={12}/>
            <Kpi label="Diferencia" value={MXN(Math.abs(catalogoGuardado.importeContrato - catalogoGuardado.totalLeido))}
              sub={pctLeido >= 98 ? ' Cuadra' : 'Revisar'} color={pctLeido >= 98 ? C.green : C.yellow} size={12}/>
          </div>
          {editar && <SecBtn onClick={() => setFase('inicio_nuevo')}>Reemplazar catálogo</SecBtn>}
        </Card>
      )}

      {/* UPLOAD — estado inicial o reemplazo */}
      {(fase === 'inicio' && !catalogoGuardado || fase === 'inicio_nuevo') && editar && (
        <Card>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:10,color:C.textMut,marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>
              1. Importe total del contrato
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:11,color:C.textMut}}>$</span>
              <input type="number" value={importeContrato} onChange={e=>setImporteContrato(parseFloat(e.target.value)||0)}
                placeholder="163348337"
                style={{background:C.bg,border:`0.5px solid ${C.borderM}`,borderRadius:6,
                  padding:'8px 12px',color:C.textPri,fontSize:14,fontWeight:600,flex:1,outline:'none'}}/>
            </div>
            <div style={{fontSize:9,color:C.textMut,marginTop:4}}>
              Este importe se usa para calcular el % de peso de cada partida y validar que el archivo cuadre.
            </div>
          </div>
          <div style={{fontSize:10,color:C.textMut,marginBottom:5,textTransform:'uppercase',letterSpacing:'0.04em'}}>
            2. Archivo del presupuesto
          </div>
          <div style={{border:`1.5px dashed ${C.borderM}`,borderRadius:10,padding:24,textAlign:'center',
            cursor:'pointer',transition:'all .2s'}}
            onClick={()=>fileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.caliza;}}
            onDragLeave={e=>{e.currentTarget.style.borderColor=C.borderM;}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.borderM;procesarArchivo(e.dataTransfer.files[0]);}}>
            {cargando
              ? <div style={{fontSize:13,color:C.caliza}}>⏳ Analizando archivo...</div>
              : <>
                  <div style={{fontSize:28,marginBottom:8}}></div>
                  <div style={{fontSize:13,fontWeight:600,color:C.textSec,marginBottom:4}}>
                    Arrastra el Excel del presupuesto aquí
                  </div>
                  <div style={{fontSize:10,color:C.textMut}}>
                    Formatos soportados: .xlsx, .xls, .csv · Cualquier estructura
                  </div>
                </>}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
            onChange={e=>procesarArchivo(e.target.files[0])}/>
          {error && <div style={{background:'rgba(220,38,38,0.12)',border:`0.5px solid rgba(220,38,38,0.3)`,
            borderRadius:7,padding:'8px 12px',fontSize:11,color:C.red,marginTop:8}}>{error}</div>}
        </Card>
      )}

      {/* REVISIÓN — resultados del parser */}
      {fase === 'revisando' && resultado && (
        <>
          {/* Validación de totales */}
          <Card accent={pctLeido >= 98 ? C.green : pctLeido >= 90 ? C.yellow : C.red}>
            <Tit>Validación del archivo</Tit>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:10}}>
              <Kpi label="Conceptos leídos" value={resultado.conceptos.length} sub={`de ${resultado.nFilasLeidas} filas`} color={C.blue}/>
              <Kpi label="Total contrato" value={MXN(importeContrato)} sub="capturado manual" color={C.caliza} size={12}/>
              <Kpi label="Total leído" value={MXN(resultado.totalLeido)} sub="suma del archivo" color={C.green} size={12}/>
              <Kpi label="Diferencia" value={MXN(difTotal)}
                sub={pctLeido>=98?' Cuadra correctamente':pctLeido>=90?'Diferencia menor — ok':' Revisar columnas'}
                color={pctLeido>=98?C.green:pctLeido>=90?C.yellow:C.red} size={12}/>
            </div>
            {/* Barra de cuadre */}
            <div style={{marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:C.textMut,marginBottom:3}}>
                <span>Total leído vs contrato</span>
                <span style={{color:pctLeido>=98?C.green:C.yellow,fontWeight:600}}>{pctLeido.toFixed(1)}%</span>
              </div>
              <div style={{background:'rgba(255,254,249,0.08)',borderRadius:99,height:7,overflow:'hidden'}}>
                <div style={{width:`${Math.min(pctLeido,100)}%`,height:'100%',
                  background:pctLeido>=98?C.green:pctLeido>=90?C.yellow:C.red,borderRadius:99,transition:'width .4s'}}/>
              </div>
            </div>
            {pctLeido < 90 && (
              <div style={{fontSize:10,color:C.yellow,marginTop:6}}>
                 La diferencia es mayor al 10%. Verifica que el importe del contrato sea correcto
                y que el archivo no tenga filas de subtotales que estén duplicando importes.
              </div>
            )}
            <div style={{fontSize:9,color:C.textMut,marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`}}>
              Columnas detectadas automáticamente:
              Clave (col {resultado.colsDetectadas.colClave+1}) ·
              Descripción (col {resultado.colsDetectadas.colDesc+1}) ·
              Unidad (col {resultado.colsDetectadas.colUnidad >= 0 ? resultado.colsDetectadas.colUnidad+1 : '—'}) ·
              P.U. (col {resultado.colsDetectadas.colPU >= 0 ? resultado.colsDetectadas.colPU+1 : '—'}) ·
              Importe (col {resultado.colsDetectadas.colImporte+1})
            </div>
          </Card>

          {/* Vista previa de conceptos */}
          <Card>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
              <Tit>Vista previa — {resultado.conceptos.length} conceptos</Tit>
              <input value={filtro} onChange={e=>{setFiltro(e.target.value);setPaginaActual(0);}}
                placeholder="Buscar clave o descripción..."
                style={{background:C.bg,border:`0.5px solid ${C.borderM}`,borderRadius:6,
                  padding:'5px 10px',color:C.textPri,fontSize:11,width:200,outline:'none'}}/>
            </div>

            {/* Tabla de conceptos */}
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                <thead>
                  <tr style={{background:C.bg}}>
                    {['Clave','Descripción','Und','Cantidad','P.U.','Importe','% Contrato'].map(h=>(
                      <th key={h} style={{padding:'6px 8px',textAlign:h==='Descripción'?'left':'right',
                        fontSize:9,color:C.textMut,fontWeight:600,textTransform:'uppercase',
                        letterSpacing:'0.04em',whiteSpace:'nowrap',
                        borderBottom:`0.5px solid ${C.border}`}}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conceptosPagina.map((c,i)=>(
                    <tr key={c.id} style={{background:i%2===0?C.calizaD:'transparent',
                      borderBottom:`0.5px solid rgba(255,254,249,0.05)`}}>
                      <td style={{padding:'5px 8px',fontSize:10,color:C.textMut,
                        fontFamily:'monospace',whiteSpace:'nowrap'}}>{c.clave}</td>
                      <td style={{padding:'5px 8px',color:C.textSec,maxWidth:280,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.desc}</td>
                      <td style={{padding:'5px 8px',textAlign:'right',color:C.textMut,
                        fontSize:10,whiteSpace:'nowrap'}}>{c.unidad||'—'}</td>
                      <td style={{padding:'5px 8px',textAlign:'right',color:C.textSec}}>
                        {c.cant>0?c.cant.toLocaleString('es-MX',{maximumFractionDigits:2}):'—'}
                      </td>
                      <td style={{padding:'5px 8px',textAlign:'right',color:C.textSec}}>
                        {c.pu>0?MXN(c.pu):'—'}
                      </td>
                      <td style={{padding:'5px 8px',textAlign:'right',color:C.caliza,fontWeight:600}}>
                        {MXN(c.importe)}
                      </td>
                      <td style={{padding:'5px 8px',textAlign:'right'}}>
                        <span style={{fontSize:10,color:C.textMut}}>{c.pctContrato.toFixed(2)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {paginas > 1 && (
              <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:8,marginTop:10}}>
                <SecBtn onClick={()=>setPaginaActual(p=>Math.max(0,p-1))} style={{padding:'4px 10px',fontSize:10}}>← Ant</SecBtn>
                <span style={{fontSize:10,color:C.textMut}}>
                  Pág {paginaActual+1} de {paginas} · {conceptosFiltrados.length} conceptos
                </span>
                <SecBtn onClick={()=>setPaginaActual(p=>Math.min(paginas-1,p+1))} style={{padding:'4px 10px',fontSize:10}}>Sig →</SecBtn>
              </div>
            )}
          </Card>

          {/* Acciones */}
          <div style={{display:'flex',gap:8}}>
            <SecBtn onClick={()=>{setFase('inicio');setResultado(null);}} style={{flex:1}}>
              ← Cargar otro archivo
            </SecBtn>
            <button onClick={confirmarCatalogo}
              style={{flex:2,background:C.caliza,border:'none',borderRadius:8,padding:10,
                fontSize:13,fontWeight:700,color:C.bg,cursor:'pointer',letterSpacing:'0.03em'}}>
               Confirmar y guardar catálogo
            </button>
          </div>
        </>
      )}

      {/* CONFIRMADO */}
      {fase === 'confirmado' && catalogoGuardado && (
        <Card accent={C.green}>
          <div style={{fontSize:13,fontWeight:600,color:C.green,marginBottom:8}}>
             Catálogo guardado correctamente
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
            <Kpi label="Conceptos" value={catalogoGuardado.conceptos.length} sub="partidas" color={C.blue}/>
            <Kpi label="Importe contrato" value={MXN(catalogoGuardado.importeContrato)} sub="validado" color={C.caliza} size={12}/>
            <Kpi label="Total leído" value={MXN(catalogoGuardado.totalLeido)} sub="del archivo" color={C.green} size={12}/>
          </div>
          <div style={{fontSize:10,color:C.textMut}}>
            El catálogo ya está disponible en "Capturar avance" para registrar el avance por concepto.
          </div>
          {editar && (
            <SecBtn onClick={()=>setFase('inicio_nuevo')} style={{marginTop:10}}>
              Reemplazar catálogo
            </SecBtn>
          )}
        </Card>
      )}

      {/* Vista del catálogo guardado */}
      {catalogoGuardado && fase === 'inicio' && (
        <Card>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
            <Tit>Catálogo activo — {catalogoGuardado.conceptos.length} conceptos</Tit>
            <input value={filtro} onChange={e=>{setFiltro(e.target.value);setPaginaActual(0);}}
              placeholder="Buscar..."
              style={{background:C.bg,border:`0.5px solid ${C.borderM}`,borderRadius:6,
                padding:'5px 10px',color:C.textPri,fontSize:11,width:160,outline:'none'}}/>
          </div>
          {(() => {
            const cats = catalogoGuardado.conceptos.filter(c =>
              !filtro || c.clave.toLowerCase().includes(filtro.toLowerCase()) ||
              c.desc.toLowerCase().includes(filtro.toLowerCase())
            );
            const pags = Math.ceil(cats.length / POR_PAG);
            const catsPag = cats.slice(paginaActual * POR_PAG, (paginaActual+1) * POR_PAG);
            return <>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                  <thead>
                    <tr style={{background:C.bg}}>
                      {['Clave','Descripción','Und','Cantidad','P.U.','Importe','% Contrato'].map(h=>(
                        <th key={h} style={{padding:'6px 8px',textAlign:h==='Descripción'?'left':'right',
                          fontSize:9,color:C.textMut,fontWeight:600,textTransform:'uppercase',
                          letterSpacing:'0.04em',whiteSpace:'nowrap',
                          borderBottom:`0.5px solid ${C.border}`}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catsPag.map((c,i)=>(
                      <tr key={c.id} style={{background:i%2===0?C.calizaD:'transparent',
                        borderBottom:`0.5px solid rgba(255,254,249,0.05)`}}>
                        <td style={{padding:'5px 8px',fontSize:10,color:C.textMut,fontFamily:'monospace',whiteSpace:'nowrap'}}>{c.clave}</td>
                        <td style={{padding:'5px 8px',color:C.textSec,maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.desc}</td>
                        <td style={{padding:'5px 8px',textAlign:'right',color:C.textMut,fontSize:10}}>{c.unidad||'—'}</td>
                        <td style={{padding:'5px 8px',textAlign:'right',color:C.textSec}}>
                          {c.cant>0?c.cant.toLocaleString('es-MX',{maximumFractionDigits:2}):'—'}
                        </td>
                        <td style={{padding:'5px 8px',textAlign:'right',color:C.textSec}}>{c.pu>0?MXN(c.pu):'—'}</td>
                        <td style={{padding:'5px 8px',textAlign:'right',color:C.caliza,fontWeight:600}}>{MXN(c.importe)}</td>
                        <td style={{padding:'5px 8px',textAlign:'right'}}>
                          <span style={{fontSize:10,color:c.pctContrato>10?C.red:c.pctContrato>5?C.yellow:C.textMut}}>
                            {c.pctContrato.toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pags > 1 && (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:8,marginTop:10}}>
                  <SecBtn onClick={()=>setPaginaActual(p=>Math.max(0,p-1))} style={{padding:'4px 10px',fontSize:10}}>← Ant</SecBtn>
                  <span style={{fontSize:10,color:C.textMut}}>Pág {paginaActual+1} de {pags} · {cats.length} conceptos</span>
                  <SecBtn onClick={()=>setPaginaActual(p=>Math.min(pags-1,p+1))} style={{padding:'4px 10px',fontSize:10}}>Sig →</SecBtn>
                </div>
              )}
            </>;
          })()}
        </Card>
      )}
    </div>
  );
}


// ── GESTIÓN DE NÓMINA SEMANAL ──────────────────────────────────────────────
function parsearNomina(data) {
  // Parser inteligente — detecta columnas por patrón
  const filas = data.filter(row => row.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
  if (filas.length < 3) return {trabajadores:[], semana:'', errores:['Archivo demasiado pequeño']};

  // Buscar fila de headers (primera con ≥4 columnas con texto)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const textCols = filas[i].filter(c => c && isNaN(Number(String(c).replace(/[$,]/g,''))) && String(c).trim().length > 1).length;
    if (textCols >= 4) { headerIdx = i; break; }
  }
  const headers = filas[headerIdx].map(h => String(h||'').toLowerCase().trim());
  const dataRows = filas.slice(headerIdx + 1);

  // Detectar columnas por keywords en headers
  const find = (...keys) => {
    for (const k of keys) {
      const idx = headers.findIndex(h => h.includes(k));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  // Si no hay headers claros, detectar por patrón de datos
  let colNombre   = find('nombre','trabajador','empleado','personal');
  let colCategoria= find('categoria','puesto','cargo','clasificacion','categ');
  let colTipo     = find('tipo','frente','directo','indirecto');
  let colSalDia   = find('salario dia','sal dia','s.d.','diario');
  let colSalSem   = find('salario sem','sal sem','semanal','semana');
  let colDias     = find('dias trab','d.t.','dias','jornada');
  let colHE       = find('horas ext','t.e.','he ','h.e.','extra');
  let colImpDias  = find('importe dia','imp dia','imp. d');
  let colImpHE    = find('importe ext','imp ext','imp. he','imp he');
  let colTotal    = find('total','importe total','pago','neto');
  let colImss     = find('imss','seguro');
  let colInfonavit= find('infonavit','fonacot');

  // Fallback: detectar por patrón si headers no fueron claros
  if (colNombre < 0 || colTotal < 0) {
    const nCols = filas[0]?.length || 0;
    const colStats = Array.from({length: nCols}, () => ({
      numCount:0, textCount:0, longTextCount:0, avgNum:0, nums:[]
    }));
    dataRows.slice(0, 30).forEach(row => {
      row.forEach((cell, ci) => {
        const s = String(cell||'').trim();
        if (!s) return;
        const n = Math.abs(parseFloat(s.replace(/[$,]/g,'')));
        if (!isNaN(n) && n > 0) {
          colStats[ci].numCount++;
          colStats[ci].nums.push(n);
        } else {
          colStats[ci].textCount++;
          if (s.length > 10) colStats[ci].longTextCount++;
        }
      });
    });
    colStats.forEach(cs => {
      if (cs.nums.length > 0) cs.avgNum = cs.nums.reduce((a,b)=>a+b,0)/cs.nums.length;
    });
    // Nombre: mayor texto largo
    if (colNombre < 0) {
      colNombre = colStats.reduce((best,cs,ci) => cs.longTextCount > (colStats[best]?.longTextCount||0) ? ci : best, 0);
    }
    // Total: mayor promedio numérico
    const numCols = colStats.map((cs,ci)=>({ci,...cs})).filter(cs=>cs.numCount>3).sort((a,b)=>b.avgNum-a.avgNum);
    if (colTotal < 0 && numCols.length > 0) colTotal = numCols[0].ci;
    if (colHE < 0 && numCols.length > 2) colHE = numCols[numCols.length-1].ci;
  }

  // Extraer semana del encabezado del archivo
  let semana = '';
  for (let i = 0; i < Math.min(headerIdx, 8); i++) {
    const rowText = filas[i].join(' ');
    const mSem = rowText.match(/semana\s*(\d+)/i) || rowText.match(/s\.?\s*(\d{2})/i);
    const mFec = rowText.match(/(\d{1,2})\s*(?:de|\/)\s*(\w+)\s*(?:al|a|-)\s*(\d{1,2})\s*(?:de|\/)\s*(\w+)/i);
    if (mSem) semana = `Semana ${mSem[1]}`;
    if (mFec && !semana) semana = rowText.match(/\d{1,2}[^.]*\d{4}/)?.[0]?.trim() || '';
  }
  if (!semana) semana = `Semana ${new Date().toLocaleDateString('es-MX')}`;

  // Parsear trabajadores
  const trabajadores = [];
  dataRows.forEach((row, ri) => {
    const nombre = colNombre >= 0 ? String(row[colNombre]||'').trim() : '';
    if (!nombre || nombre.length < 3) return;
    // Filtrar filas de totales/subtotales
    if (/^total|^subtotal|^suma/i.test(nombre)) return;
    // Filtrar si no hay importe
    const total = colTotal >= 0 ? Math.abs(parseFloat(String(row[colTotal]||'').replace(/[$,]/g,''))||0) : 0;
    if (total === 0 && ri > 0) return;

    const categoria  = colCategoria  >= 0 ? String(row[colCategoria] ||'').trim() : '';
    const tipoRaw    = colTipo       >= 0 ? String(row[colTipo]      ||'').trim().toUpperCase() : '';
    const tipo       = tipoRaw.includes('IND') ? 'I' : 'D';
    const salDia     = colSalDia     >= 0 ? Math.abs(parseFloat(String(row[colSalDia]    ||'').replace(/[$,]/g,''))||0) : 0;
    const salSem     = colSalSem     >= 0 ? Math.abs(parseFloat(String(row[colSalSem]    ||'').replace(/[$,]/g,''))||0) : 0;
    const dias       = colDias       >= 0 ? Math.abs(parseFloat(String(row[colDias]      ||'').replace(/[$,]/g,''))||0) : 0;
    const horasExtra = colHE         >= 0 ? Math.abs(parseFloat(String(row[colHE]        ||'').replace(/[$,]/g,''))||0) : 0;
    const impDias    = colImpDias    >= 0 ? Math.abs(parseFloat(String(row[colImpDias]   ||'').replace(/[$,]/g,''))||0) : 0;
    const impHE      = colImpHE      >= 0 ? Math.abs(parseFloat(String(row[colImpHE]     ||'').replace(/[$,]/g,''))||0) : 0;
    const imss       = colImss       >= 0 ? Math.abs(parseFloat(String(row[colImss]      ||'').replace(/[$,]/g,''))||0) : 0;
    const infonavit  = colInfonavit  >= 0 ? Math.abs(parseFloat(String(row[colInfonavit] ||'').replace(/[$,]/g,''))||0) : 0;

    trabajadores.push({
      id: `${ri}-${nombre.slice(0,10)}`,
      nombre, categoria, tipo, salDia, salSem, dias,
      horasExtra, impDias, impHE, imss, infonavit, total
    });
  });

  return {trabajadores, semana, colsDetectadas:{colNombre,colCategoria,colTipo,colHE,colTotal}};
}

function Nomina({obra, rol}) {
  // Cargar SheetJS dinámicamente al montar
  useEffect(() => {
    if (typeof window.XLSX === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      document.head.appendChild(s);
    }
  }, []);
  const [historial, setHistorial] = useState([]);
  useEffect(()=>{
    fsGet(`obras/${obra.id}/nomina/historial`).then(d=>{
      if(d&&Array.isArray(d.semanas)) setHistorial(d.semanas);
    });
  },[obra.id]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState('');
  const [vistaTab, setVistaTab]   = useState('actual'); // actual | historico | analisis
  const [semanaVer, setSemanaVer] = useState(0); // índice del historial
  const fileRef = useRef();
  const editar  = can(rol, 'captura', 'editar');

  const semanaActual = historial.length > 0 ? historial[historial.length - 1] : null;
  const semanaAnterior = historial.length > 1 ? historial[historial.length - 2] : null;

  function procesarArchivo(file) {
    if (!file) return;
    setCargando(true); setError('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        let rows;
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'csv') {
          const text = new TextDecoder().decode(e.target.result);
          rows = text.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g,'')));
        } else {
          const wb = window.XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
        }
        const resultado = parsearNomina(rows);
        if (resultado.trabajadores.length === 0) {
          setError('No se encontraron trabajadores en el archivo. Verifica el formato.');
          setCargando(false); return;
        }
        const nueva = {
          semana: resultado.semana,
          fecha: new Date().toLocaleDateString('es-MX'),
          archivo: file.name,
          trabajadores: resultado.trabajadores,
          totalNomina: resultado.trabajadores.reduce((t,p)=>t+p.total,0),
          totalHE: resultado.trabajadores.reduce((t,p)=>t+p.impHE,0),
          totalDir: resultado.trabajadores.filter(p=>p.tipo==='D').length,
          totalInd: resultado.trabajadores.filter(p=>p.tipo==='I').length,
        };
        const nuevo_hist = [...historial, nueva];
        fsSet(`obras/${obra.id}/nomina/historial`, {semanas:nuevo_hist});
        setHistorial(nuevo_hist);
        setVistaTab('actual');
        setSemanaVer(nuevo_hist.length - 1);
      } catch(err) {
        setError('Error al leer el archivo: ' + err.message);
      }
      setCargando(false);
    };
    reader.readAsArrayBuffer(file);
  }

  function eliminarSemana(idx) {
    const nuevo = historial.filter((_,i) => i !== idx);
    fsSet(`obras/${obra.id}/nomina/historial`, {semanas:nuevo});
    setHistorial(nuevo);
    setSemanaVer(Math.max(0, idx-1));
  }

  // KPIs comparativos
  const deltaPersonal = semanaActual && semanaAnterior
    ? (semanaActual.totalDir + semanaActual.totalInd) - (semanaAnterior.totalDir + semanaAnterior.totalInd) : 0;
  const deltaNomina = semanaActual && semanaAnterior
    ? semanaActual.totalNomina - semanaAnterior.totalNomina : 0;
  const deltaHE = semanaActual && semanaAnterior
    ? semanaActual.totalHE - semanaAnterior.totalHE : 0;

  // Trabajadores con más horas extra en semana actual
  const topHE = semanaActual
    ? [...semanaActual.trabajadores].filter(p=>p.horasExtra>0).sort((a,b)=>b.horasExtra-a.horasExtra).slice(0,10)
    : [];

  // Comparativa de trabajadores entre semanas (quién subió más)
  const topIncremento = semanaActual && semanaAnterior ? (() => {
    const anterior = new Map(semanaAnterior.trabajadores.map(p=>[p.nombre.trim().toLowerCase(), p.total]));
    return semanaActual.trabajadores
      .map(p => ({...p, delta: p.total - (anterior.get(p.nombre.trim().toLowerCase()) || 0)}))
      .filter(p => p.delta > 500)
      .sort((a,b) => b.delta - a.delta)
      .slice(0, 10);
  })() : [];

  // Altas (nuevos en semana actual vs anterior)
  const altas = semanaActual && semanaAnterior ? (() => {
    const anteriorNombres = new Set(semanaAnterior.trabajadores.map(p=>p.nombre.trim().toLowerCase()));
    return semanaActual.trabajadores.filter(p => !anteriorNombres.has(p.nombre.trim().toLowerCase()));
  })() : [];

  // Bajas (en anterior pero no en actual)
  const bajas = semanaActual && semanaAnterior ? (() => {
    const actualNombres = new Set(semanaActual.trabajadores.map(p=>p.nombre.trim().toLowerCase()));
    return semanaAnterior.trabajadores.filter(p => !actualNombres.has(p.nombre.trim().toLowerCase()));
  })() : [];

  const semVer = historial[semanaVer];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>


      {/* Header + upload */}
      <Card>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div>
            <Tit>Nómina semanal — {obra.nombre}</Tit>
            <div style={{fontSize:10,color:C.textMut,marginTop:-6}}>
              {historial.length > 0
                ? `${historial.length} semana(s) cargada(s) · Última: ${semanaActual?.semana}`
                : 'Sin nóminas cargadas aún'}
            </div>
          </div>
          {editar && (
            <button onClick={()=>fileRef.current?.click()}
              style={{background:cargando?C.surface:C.caliza,border:'none',borderRadius:8,
                padding:'8px 16px',fontSize:11,fontWeight:700,
                color:cargando?C.textMut:C.bg,cursor:cargando?'not-allowed':'pointer',flexShrink:0}}>
              {cargando ? '⏳ Leyendo...' : ' Cargar nómina'}
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
            onChange={e=>procesarArchivo(e.target.files[0])}/>
        </div>
        {error && (
          <div style={{background:'rgba(220,38,38,0.12)',border:`0.5px solid rgba(220,38,38,0.3)`,
            borderRadius:7,padding:'8px 12px',fontSize:11,color:C.red,marginTop:8}}>{error}</div>
        )}
      </Card>

      {historial.length === 0 && (
        <Card>
          <div style={{textAlign:'center',padding:'24px 0',color:C.textMut}}>
            <div style={{fontSize:32,marginBottom:8}}></div>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Sin nóminas cargadas</div>
            <div style={{fontSize:11}}>Sube el Excel de nómina semanal con el botón de arriba.</div>
            <div style={{fontSize:10,marginTop:4}}>El parser detecta automáticamente el formato del archivo.</div>
          </div>
        </Card>
      )}

      {historial.length > 0 && <>
        {/* KPIs semana actual vs anterior */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(108px,1fr))',gap:8}}>
          <Kpi label="Total personal" value={semanaActual.totalDir+semanaActual.totalInd}
            sub={deltaPersonal!==0?`${deltaPersonal>0?'+':''}${deltaPersonal} vs sem. ant.`:'sin cambio'}
            color={deltaPersonal>0?C.yellow:deltaPersonal<0?C.red:C.caliza}/>
          <Kpi label="Directo" value={semanaActual.totalDir} sub="mano de obra" color={C.blue}/>
          <Kpi label="Indirecto" value={semanaActual.totalInd} sub="administración" color={C.purple}/>
          <Kpi label="Total nómina" value={MXN(semanaActual.totalNomina)}
            sub={deltaNomina!==0?`${deltaNomina>0?'+':''}${MXN(deltaNomina)} vs sem. ant.`:'sin cambio'}
            color={deltaNomina>0?C.yellow:C.caliza} size={12}/>
          <Kpi label="Horas extra" value={MXN(semanaActual.totalHE)}
            sub={deltaHE!==0?`${deltaHE>0?'+':''}${MXN(deltaHE)} vs sem. ant.`:'sin cambio'}
            color={deltaHE>0?C.orange:C.caliza} size={12}/>
          {altas.length>0&&<Kpi label="Altas" value={altas.length} sub="nuevos esta semana" color={C.green}/>}
          {bajas.length>0&&<Kpi label="Bajas" value={bajas.length} sub="salieron esta semana" color={C.red}/>}
        </div>

        {/* Tabs de vista */}
        <div className="noscroll" style={{display:'flex',gap:4,overflowX:'auto',flexShrink:0}}>
          {[['actual','Lista actual'],['analisis','Análisis'],['historico','Historial']].map(([id,lbl])=>(
            <button key={id} onClick={()=>setVistaTab(id)} style={{flex:'0 0 auto',padding:'7px 14px',
              fontSize:11,borderRadius:8,background:vistaTab===id?C.caliza:C.card,
              border:`0.5px solid ${vistaTab===id?C.caliza:C.border}`,
              color:vistaTab===id?C.bg:C.textSec,fontWeight:vistaTab===id?700:400,whiteSpace:'nowrap'}}>
              {lbl}
            </button>
          ))}
        </div>

        {/* VISTA: Lista actual */}
        {vistaTab==='actual' && semVer && (
          <Card>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
              <div>
                <Tit>{semVer.semana}</Tit>
                <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>
                  {semVer.trabajadores.length} trabajadores · Cargado {semVer.fecha} · {semVer.archivo}
                </div>
              </div>
              {/* Selector de semana */}
              {historial.length > 1 && (
                <Sel value={semanaVer} onChange={e=>setSemanaVer(Number(e.target.value))}
                  style={{fontSize:10,padding:'4px 8px'}}>
                  {historial.map((s,i)=><option key={i} value={i}>{s.semana}</option>)}
                </Sel>
              )}
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                <thead>
                  <tr>
                    {['Nombre','Categoría','Tipo','Días','HE hrs','Total','+ vs ant.'].map(h=>(
                      <th key={h} style={{padding:'6px 8px',textAlign:h==='Nombre'||h==='Categoría'?'left':'right',
                        fontSize:9,color:C.textMut,fontWeight:600,textTransform:'uppercase',
                        letterSpacing:'0.04em',borderBottom:`0.5px solid ${C.border}`,whiteSpace:'nowrap'}}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semVer.trabajadores.slice().sort((a,b)=>b.total-a.total).map((p,i)=>{
                    const prevTotal = semanaAnterior && semVer===semanaActual
                      ? semanaAnterior.trabajadores.find(x=>x.nombre.trim().toLowerCase()===p.nombre.trim().toLowerCase())?.total || 0
                      : 0;
                    const delta = semVer===semanaActual ? p.total - prevTotal : 0;
                    const esAlta = altas.some(a=>a.nombre===p.nombre);
                    return (
                      <tr key={p.id} style={{background:i%2===0?'rgba(255,254,249,0.03)':'transparent',
                        borderBottom:`0.5px solid rgba(255,254,249,0.05)`}}>
                        <td style={{padding:'5px 8px',color:C.textPri}}>
                          <span>{p.nombre}</span>
                          {esAlta&&<span style={{marginLeft:4,fontSize:8,background:`${C.green}22`,color:C.green,
                            borderRadius:3,padding:'1px 4px'}}>ALTA</span>}
                        </td>
                        <td style={{padding:'5px 8px',color:C.textMut,fontSize:10}}>{p.categoria||'—'}</td>
                        <td style={{padding:'5px 8px',textAlign:'right'}}>
                          <Bdg color={p.tipo==='D'?C.blue:C.purple} small>{p.tipo==='D'?'D':'I'}</Bdg>
                        </td>
                        <td style={{padding:'5px 8px',textAlign:'right',color:C.textSec}}>{p.dias||'—'}</td>
                        <td style={{padding:'5px 8px',textAlign:'right',
                          color:p.horasExtra>=20?C.red:p.horasExtra>0?C.orange:C.textMut,fontWeight:p.horasExtra>=20?700:400}}>
                          {p.horasExtra>0?`${p.horasExtra}hrs`:'—'}
                        </td>
                        <td style={{padding:'5px 8px',textAlign:'right',color:C.caliza,fontWeight:600}}>
                          {MXN(p.total)}
                        </td>
                        <td style={{padding:'5px 8px',textAlign:'right',fontSize:10}}>
                          {delta!==0
                            ? <span style={{color:delta>0?C.yellow:C.green}}>{delta>0?'+':''}{MXN(delta)}</span>
                            : <span style={{color:C.textMut}}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* VISTA: Análisis */}
        {vistaTab==='analisis' && semanaActual && (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {/* Top HE */}
            {topHE.length > 0 && (
              <Card accent={C.orange}>
                <Tit>Top trabajadores — horas extra esta semana</Tit>
                {topHE.map((p,i)=>(
                  <div key={p.id} style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto',
                    gap:8,alignItems:'center',marginBottom:6,paddingBottom:6,
                    borderBottom:i<topHE.length-1?`0.5px solid ${C.border}`:'none'}}>
                    <span style={{fontSize:11,color:C.textMut,width:20}}>{i+1}</span>
                    <div>
                      <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
                      <div style={{fontSize:9,color:C.textMut}}>{p.categoria}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,fontWeight:700,color:p.horasExtra>=20?C.red:C.orange}}>
                        {p.horasExtra}hrs
                      </div>
                      <div style={{fontSize:9,color:C.textMut}}>{MXN(p.impHE)}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.caliza}}>{MXN(p.total)}</div>
                      <div style={{fontSize:9,color:C.textMut}}>total</div>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {/* Altas y bajas */}
            {(altas.length > 0 || bajas.length > 0) && (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {altas.length > 0 && (
                  <Card accent={C.green}>
                    <Tit> Altas esta semana ({altas.length})</Tit>
                    {altas.map(p=>(
                      <div key={p.id} style={{marginBottom:5,paddingBottom:5,borderBottom:`0.5px solid ${C.border}`}}>
                        <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:C.textMut,marginTop:2}}>
                          <span>{p.categoria}</span>
                          <span style={{color:C.green,fontWeight:600}}>{MXN(p.total)}</span>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
                {bajas.length > 0 && (
                  <Card accent={C.red}>
                    <Tit> Bajas vs semana anterior ({bajas.length})</Tit>
                    {bajas.map(p=>(
                      <div key={p.id} style={{marginBottom:5,paddingBottom:5,borderBottom:`0.5px solid ${C.border}`}}>
                        <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:C.textMut,marginTop:2}}>
                          <span>{p.categoria}</span>
                          <span style={{color:C.red}}>{MXN(p.total)}</span>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            )}

            {/* Incrementos individuales */}
            {topIncremento.length > 0 && (
              <Card accent={C.yellow}>
                <Tit>Mayores incrementos individuales vs semana anterior</Tit>
                <div style={{fontSize:9,color:C.textMut,marginBottom:8}}>
                  Trabajadores cuyo pago subió significativamente — revisar si corresponde a horas extra, bonos o ajuste de categoría.
                </div>
                {topIncremento.map((p,i)=>(
                  <div key={p.id} style={{display:'grid',gridTemplateColumns:'auto 1fr auto auto',
                    gap:8,alignItems:'center',marginBottom:6,paddingBottom:6,
                    borderBottom:i<topIncremento.length-1?`0.5px solid ${C.border}`:'none'}}>
                    <span style={{fontSize:11,color:C.textMut,width:20}}>{i+1}</span>
                    <div>
                      <div style={{fontSize:11,color:C.textPri}}>{p.nombre}</div>
                      <div style={{fontSize:9,color:C.textMut}}>{p.categoria}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,color:C.yellow,fontWeight:700}}>+{MXN(p.delta)}</div>
                      <div style={{fontSize:9,color:C.textMut}}>incremento</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.caliza}}>{MXN(p.total)}</div>
                      <div style={{fontSize:9,color:C.textMut}}>total sem.</div>
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {/* Resumen por categoría */}
            <Card>
              <Tit>Distribución por categoría</Tit>
              {(() => {
                const cats = {};
                semanaActual.trabajadores.forEach(p => {
                  const cat = p.categoria || 'Sin categoría';
                  if (!cats[cat]) cats[cat] = {count:0, total:0, he:0};
                  cats[cat].count++;
                  cats[cat].total += p.total;
                  cats[cat].he += p.horasExtra;
                });
                const sorted = Object.entries(cats).sort((a,b)=>b[1].total-a[1].total);
                const maxTotal = sorted[0]?.[1].total || 1;
                return sorted.map(([cat, d]) => (
                  <div key={cat} style={{marginBottom:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3,gap:6}}>
                      <span style={{color:C.textSec,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {cat} <span style={{color:C.textMut,fontSize:9}}>({d.count} pers.)</span>
                      </span>
                      <div style={{display:'flex',gap:8,flexShrink:0}}>
                        {d.he>0&&<span style={{fontSize:9,color:C.orange}}>{d.he}hrs HE</span>}
                        <span style={{fontWeight:600,color:C.caliza}}>{MXN(d.total)}</span>
                      </div>
                    </div>
                    <Bar pct={d.total/maxTotal*100} color="rgba(255,254,249,0.3)"/>
                  </div>
                ));
              })()}
            </Card>
          </div>
        )}

        {/* VISTA: Historial */}
        {vistaTab==='historico' && (
          <Card>
            <Tit>Historial de semanas cargadas</Tit>
            {historial.slice().reverse().map((sem, ri) => {
              const i = historial.length - 1 - ri;
              const prev = i > 0 ? historial[i-1] : null;
              const deltaTot = prev ? sem.totalNomina - prev.totalNomina : 0;
              const deltaP   = prev ? (sem.totalDir+sem.totalInd) - (prev.totalDir+prev.totalInd) : 0;
              return (
                <div key={i} style={{background:C.bg,borderRadius:8,padding:'10px 12px',
                  marginBottom:8,borderLeft:`3px solid ${i===historial.length-1?C.caliza:C.border}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:C.caliza}}>{sem.semana}</div>
                      <div style={{fontSize:9,color:C.textMut}}>{sem.fecha} · {sem.archivo}</div>
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      {i===historial.length-1&&<Bdg color={C.green} small>Actual</Bdg>}
                      {editar&&<button onClick={()=>eliminarSemana(i)}
                        style={{background:'none',border:`0.5px solid rgba(220,38,38,0.3)`,
                          borderRadius:4,padding:'2px 7px',fontSize:9,color:C.red,cursor:'pointer'}}>
                        Eliminar
                      </button>}
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(90px,1fr))',gap:6}}>
                    {[
                      ['Personal',sem.totalDir+sem.totalInd,deltaP!==0?`${deltaP>0?'+':''}${deltaP}`:'',C.caliza],
                      ['Directo',sem.totalDir,'',C.blue],
                      ['Indirecto',sem.totalInd,'',C.purple],
                      ['Total nómina',MXN(sem.totalNomina),deltaTot!==0?`${deltaTot>0?'+':''}${MXN(deltaTot)}`:'',deltaTot>0?C.yellow:C.caliza],
                      ['Horas extra',MXN(sem.totalHE),'',C.orange],
                    ].map(([l,v,sub,col])=>(
                      <div key={l} style={{background:C.card,borderRadius:6,padding:'6px 8px'}}>
                        <div style={{fontSize:8,color:C.textMut,marginBottom:2}}>{l}</div>
                        <div style={{fontSize:11,fontWeight:700,color:col}}>{v}</div>
                        {sub&&<div style={{fontSize:8,color:col,marginTop:1}}>{sub}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </>}
    </div>
  );
}


// ── PESTAÑA CONTRATO ───────────────────────────────────────────────────────
function Contrato({obra, setObra, rol}) {
  const [tab, setTab] = useState("datos"); // datos | plazos | documentos
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docs, setDocs] = useState([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ampliaciones, setAmpliaciones] = useState([]);
  const [showAddAmp, setShowAddAmp] = useState(false);
  const [nuevaAmp, setNuevaAmp] = useState({fecha:"", justificacion:"", autorizadoPor:""});
  const fileRef = useRef();
  const editar = can(rol, "captura", "editar") || can(rol, "estimaciones", "editar");
  const puedeSubir = ["director_operaciones","gerente_construccion","administrador_obra"].includes(rol) ||
                     rol==="superintendente_obra";
  const puedeElimDoc = ["director_operaciones","gerente_construccion"].includes(rol);

  // Cargar ampliaciones y documentos desde Firestore
  useEffect(()=>{
    fsGet(`obras/${obra.id}/contrato/plazos`).then(d=>{
      if(d&&Array.isArray(d.ampliaciones)) setAmpliaciones(d.ampliaciones);
    });
    fsGet(`obras/${obra.id}/contrato/documentos`).then(d=>{
      if(d&&Array.isArray(d.lista)) setDocs(d.lista);
      setDocsLoaded(true);
    });
  },[obra.id]);

  // Guardar datos del contrato
  async function guardarDatos() {
    setSaving(true);
    await fsSet(`obras/${obra.id}/config/info`, {
      nombre:obra.nombre, contrato:obra.contrato, cliente:obra.cliente,
      superintendente:obra.superintendente, residente:obra.residente,
      admin:obra.admin, inicio:obra.inicio, fin:obra.fin,
      finAmpliado:obra.finAmpliado||"", presupuesto:obra.presupuesto,
    });
    setSaving(false); setSaved(true);
    setTimeout(()=>setSaved(false), 2500);
  }

  // Agregar ampliación
  async function agregarAmpliacion() {
    if(!nuevaAmp.fecha||!nuevaAmp.justificacion) return;
    const amp = {...nuevaAmp, id: Date.now(), fechaRegistro: new Date().toISOString()};
    const nuevo = [...ampliaciones, amp];
    setAmpliaciones(nuevo);
    await fsSet(`obras/${obra.id}/contrato/plazos`, {ampliaciones: nuevo});
    // Actualizar finAmpliado en la obra
    setObra({...obra, finAmpliado: nuevaAmp.fecha});
    setNuevaAmp({fecha:"", justificacion:"", autorizadoPor:""});
    setShowAddAmp(false);
  }

  async function eliminarAmpliacion(id) {
    const nuevo = ampliaciones.filter(a=>a.id!==id);
    setAmpliaciones(nuevo);
    await fsSet(`obras/${obra.id}/contrato/plazos`, {ampliaciones: nuevo});
    // Actualizar finAmpliado con la última ampliación restante
    const ultima = nuevo[nuevo.length-1];
    setObra({...obra, finAmpliado: ultima?.fecha||""});
  }

  // Subir documento
  async function subirDocumento(file) {
    if(!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        // Subir a Firebase Storage
        const url = await uploadFoto(obra.id, "documentos", Date.now().toString(),
                                     e.target.result);
        const doc = {
          id: Date.now(),
          nombre: file.name,
          tipo: file.type,
          tamaño: file.size,
          url,
          fecha: new Date().toLocaleDateString("es-MX"),
          subidoPor: "",
        };
        const nuevos = [...docs, doc];
        setDocs(nuevos);
        await fsSet(`obras/${obra.id}/contrato/documentos`, {lista: nuevos});
      } catch(e) { console.error(e); }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function eliminarDoc(id) {
    const nuevo = docs.filter(d=>d.id!==id);
    setDocs(nuevo);
    await fsSet(`obras/${obra.id}/contrato/documentos`, {lista: nuevo});
  }

  const f = (k,v) => setObra({...obra, [k]: v});

  // Calcular días entre fechas
  const diasPlazo = (ini,fin) => {
    if(!ini||!fin) return null;
    const d = (new Date(fin)-new Date(ini))/(1000*60*60*24);
    return Math.round(d);
  };

  const TIPOS_DOC = ["Contrato","Convenio modificatorio","Acta de inicio","Estimación","Oficio","Otro"];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {/* Sub-tabs */}
      <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0}}>
        {[["datos","Datos del contrato"],["plazos","Plazos y ampliaciones"],["documentos","Repositorio de documentos"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{flex:"0 0 auto",padding:"7px 14px",
            fontSize:11,borderRadius:8,background:tab===id?C.caliza:C.card,
            border:`0.5px solid ${tab===id?C.caliza:C.border}`,
            color:tab===id?C.bg:C.textSec,fontWeight:tab===id?700:400,whiteSpace:"nowrap"}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── DATOS DEL CONTRATO ── */}
      {tab==="datos"&&(
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <Tit>Información del contrato</Tit>
            {editar&&<button onClick={guardarDatos} disabled={saving}
              style={{background:saved?C.green:saving?"rgba(255,254,249,0.2)":C.caliza,
                border:"none",borderRadius:6,padding:"6px 14px",fontSize:11,fontWeight:700,
                color:saved||saving?C.caliza:C.bg,cursor:"pointer",transition:"all .3s"}}>
              {saved?"Guardado":saving?"Guardando...":"Guardar datos"}
            </button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[
              ["Número de contrato","contrato","text"],
              ["Cliente / Dependencia","cliente","text"],
              ["Superintendente de obra","superintendente","text"],
              ["Residente de obra","residente","text"],
              ["Administrador de obra","admin","text"],
              ["Presupuesto total","presupuesto","number"],
            ].map(([lbl,key,type])=>(
              <div key={key}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{lbl}</div>
                {editar
                  ? <Inp type={type} value={obra[key]||""} onChange={e=>f(key,type==="number"?parseFloat(e.target.value)||0:e.target.value)}/>
                  : <div style={{fontSize:12,color:C.textSec,padding:"5px 0",borderBottom:`0.5px solid ${C.border}`}}>{obra[key]||"—"}</div>
                }
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── PLAZOS Y AMPLIACIONES ── */}
      {tab==="plazos"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* Plazo original */}
          <Card accent={C.green}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <Tit>Plazo original del contrato</Tit>
              {editar&&<button onClick={guardarDatos} style={{background:C.caliza,border:"none",
                borderRadius:6,padding:"5px 12px",fontSize:10,fontWeight:700,color:C.bg,cursor:"pointer"}}>
                Guardar
              </button>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div>
                <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Fecha de inicio</div>
                {editar
                  ? <Inp type="date" value={obra.inicio||""} onChange={e=>f("inicio",e.target.value)}/>
                  : <div style={{fontSize:13,fontWeight:600,color:C.green}}>{obra.inicio||"—"}</div>
                }
              </div>
              <div>
                <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Fecha fin original</div>
                {editar
                  ? <Inp type="date" value={obra.fin||""} onChange={e=>f("fin",e.target.value)}/>
                  : <div style={{fontSize:13,fontWeight:600,color:C.green}}>{obra.fin||"—"}</div>
                }
              </div>
              <div>
                <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Duración</div>
                <div style={{fontSize:13,fontWeight:600,color:C.caliza}}>
                  {diasPlazo(obra.inicio,obra.fin)?`${diasPlazo(obra.inicio,obra.fin)} días`:"—"}
                </div>
              </div>
            </div>
          </Card>

          {/* Ampliaciones */}
          {ampliaciones.map((amp,i)=>(
            <Card key={amp.id} accent={i===0?C.yellow:C.orange}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <Bdg color={i===0?C.yellow:C.orange}>Ampliación {i+1}</Bdg>
                  <div style={{fontSize:13,fontWeight:700,color:C.caliza,marginTop:6}}>{amp.fecha}</div>
                </div>
                {puedeElimDoc&&<button onClick={()=>eliminarAmpliacion(amp.id)}
                  style={{background:"none",border:`0.5px solid rgba(220,38,38,0.3)`,borderRadius:4,
                    padding:"2px 8px",fontSize:9,color:C.red,cursor:"pointer"}}>Eliminar</button>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>Justificación</div>
                  <div style={{fontSize:11,color:C.textSec}}>{amp.justificacion}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>Autorizado por</div>
                  <div style={{fontSize:11,color:C.textSec}}>{amp.autorizadoPor||"—"}</div>
                </div>
              </div>
              {obra.inicio&&amp.fecha&&<div style={{fontSize:9,color:C.textMut,marginTop:6}}>
                Duración total con esta ampliación: {diasPlazo(obra.inicio,amp.fecha)} días
                {obra.fin&&` (+${diasPlazo(obra.fin,amp.fecha)} días vs plazo original)`}
              </div>}
            </Card>
          ))}

          {/* Agregar ampliación */}
          {editar&&!showAddAmp&&(
            <button onClick={()=>setShowAddAmp(true)}
              style={{background:C.card,border:`0.5px solid ${C.borderM}`,borderRadius:8,
                padding:"10px 0",fontSize:11,color:C.textSec,cursor:"pointer",
                width:"100%",textAlign:"center"}}>
              + Agregar ampliación de plazo
            </button>
          )}

          {editar&&showAddAmp&&(
            <Card accent={C.yellow}>
              <Tit>Nueva ampliación de plazo</Tit>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:8}}>
                <div>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Nueva fecha de terminación</div>
                  <Inp type="date" value={nuevaAmp.fecha} onChange={e=>setNuevaAmp(p=>({...p,fecha:e.target.value}))}/>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Justificación</div>
                  <Inp type="text" value={nuevaAmp.justificacion}
                    placeholder="Convenio modificatorio, causas de fuerza mayor, etc."
                    onChange={e=>setNuevaAmp(p=>({...p,justificacion:e.target.value}))}/>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Autorizado por</div>
                  <Inp type="text" value={nuevaAmp.autorizadoPor}
                    placeholder="Nombre del funcionario o referencia"
                    onChange={e=>setNuevaAmp(p=>({...p,autorizadoPor:e.target.value}))}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <SecBtn onClick={()=>setShowAddAmp(false)} style={{flex:1}}>Cancelar</SecBtn>
                  <button onClick={agregarAmpliacion}
                    disabled={!nuevaAmp.fecha||!nuevaAmp.justificacion}
                    style={{flex:2,background:nuevaAmp.fecha&&nuevaAmp.justificacion?C.caliza:"rgba(255,254,249,0.2)",
                      border:"none",borderRadius:6,padding:"8px 0",fontSize:12,fontWeight:700,
                      color:nuevaAmp.fecha&&nuevaAmp.justificacion?C.bg:C.textMut,
                      cursor:nuevaAmp.fecha&&nuevaAmp.justificacion?"pointer":"not-allowed"}}>
                    Registrar ampliación
                  </button>
                </div>
              </div>
            </Card>
          )}

          {ampliaciones.length===0&&!showAddAmp&&(
            <div style={{background:C.card,borderRadius:8,padding:"16px",textAlign:"center",color:C.textMut,fontSize:11}}>
              No hay ampliaciones registradas. La obra está dentro del plazo original.
            </div>
          )}
        </div>
      )}

      {/* ── REPOSITORIO DE DOCUMENTOS ── */}
      {tab==="documentos"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <Tit>Repositorio de documentos</Tit>
                <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>
                  {docs.length} documento(s) · Contrato, convenios, actas y más
                </div>
              </div>
              {puedeSubir&&(
                <button onClick={()=>fileRef.current?.click()}
                  style={{background:uploading?C.surface:C.caliza,border:"none",borderRadius:8,
                    padding:"7px 14px",fontSize:11,fontWeight:700,
                    color:uploading?C.textMut:C.bg,cursor:uploading?"not-allowed":"pointer"}}>
                  {uploading?"⏳ Subiendo...":"Subir documento"}
                </button>
              )}
              <input ref={fileRef} type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip"
                style={{display:"none"}} onChange={e=>subirDocumento(e.target.files[0])}/>
            </div>

            {docs.length===0&&docsLoaded&&(
              <div style={{textAlign:"center",padding:"24px 0",color:C.textMut}}>
                <div style={{fontSize:32,marginBottom:8}}></div>
                <div style={{fontSize:12,fontWeight:600,marginBottom:4}}>Sin documentos</div>
                <div style={{fontSize:10}}>
                  {puedeSubir?"Sube el contrato firmado y otros documentos relevantes.":"No hay documentos disponibles aún."}
                </div>
              </div>
            )}

            {docs.map((doc,i)=>{
              const ext = doc.nombre.split(".").pop().toUpperCase();
              const extCol = {PDF:C.red,DOCX:C.blue,DOC:C.blue,XLSX:C.green,XLS:C.green,
                              JPG:C.purple,JPEG:C.purple,PNG:C.purple,ZIP:C.orange}[ext]||C.textMut;
              return (
                <div key={doc.id} style={{display:"flex",alignItems:"center",gap:10,
                  padding:"10px 0",borderBottom:`0.5px solid ${C.border}`}}>
                  <div style={{background:`${extCol}22`,border:`0.5px solid ${extCol}44`,
                    borderRadius:5,padding:"4px 7px",fontSize:9,fontWeight:700,color:extCol,
                    flexShrink:0,minWidth:36,textAlign:"center"}}>{ext}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:C.textPri,overflow:"hidden",textOverflow:"ellipsis",
                      whiteSpace:"nowrap"}}>{doc.nombre}</div>
                    <div style={{fontSize:9,color:C.textMut,marginTop:2}}>
                      Subido el {doc.fecha}
                      {doc.tamaño&&` · ${(doc.tamaño/1024/1024).toFixed(1)} MB`}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <a href={doc.url} target="_blank" rel="noopener noreferrer"
                      style={{background:"none",border:`0.5px solid ${C.borderM}`,borderRadius:5,
                        padding:"4px 10px",fontSize:10,color:C.caliza,cursor:"pointer",
                        textDecoration:"none"}}>
                      Ver
                    </a>
                    <a href={doc.url} download={doc.nombre}
                      style={{background:"none",border:`0.5px solid ${C.borderM}`,borderRadius:5,
                        padding:"4px 10px",fontSize:10,color:C.caliza,cursor:"pointer",
                        textDecoration:"none"}}>
                      ↓
                    </a>
                    {puedeElimDoc&&<button onClick={()=>eliminarDoc(doc.id)}
                      style={{background:"none",border:`0.5px solid rgba(220,38,38,0.3)`,borderRadius:5,
                        padding:"4px 8px",fontSize:10,color:C.red,cursor:"pointer"}}></button>}
                  </div>
                </div>
              );
            })}
          </Card>

          <div style={{fontSize:9,color:C.textMut,textAlign:"center"}}>
            Formatos soportados: PDF, Word, Excel, imágenes y ZIP · Máximo 10MB por archivo
          </div>
        </div>
      )}
    </div>
  );
}

const TABS_POR_ROL = {
  director_general:    [{id:"dash",label:"Dashboard"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"},{id:"contrato",label:"Contrato"}],
  director_operaciones:[{id:"dash",label:"Dashboard"},{id:"captura",label:"Capturar avance"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"},{id:"presupuesto",label:"Presupuesto"},{id:"contrato",label:"Contrato"}],
  gerente_construccion:[{id:"dash",label:"Dashboard"},{id:"captura",label:"Capturar avance"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"},{id:"presupuesto",label:"Presupuesto"},{id:"contrato",label:"Contrato"}],
  administrador_obra:  [{id:"dash",label:"Dashboard"},{id:"captura",label:"Capturar avance"},{id:"gastos",label:"Gastos GP"},{id:"estimaciones",label:"Estimaciones"},{id:"riesgo",label:"Riesgo"},{id:"contrato",label:"Contrato"}],
};

const EST_DEFAULT = [
  {no:1,monto:8500000,periodo:"01–31 Mar 2026",estatus:"Pagada"},
  {no:2,monto:7200000,periodo:"01–30 Abr 2026",estatus:"Facturada"},
  {no:3,monto:6100000,periodo:"01–20 May 2026",estatus:"En proceso"},
];

export default function App(){
  const[usuario,setUsuario]=useState(null);
  const[screen,setScreen]=useState("obras");
  const[obraId,setObraId]=useState(null);
  const[tab,setTab]=useState("dash");
  const[obras,setObras]=useState(()=>{try{return loadObras();}catch{return _OBRAS_BASE.map(o=>({...o}));}});
  const[cambiosPendientes,setCambiosPendientes]=useState(false);
  const { gpData, gpLoading, gpError, gpUltActualiz, cargarGP } = useGPConstruct();

  // Al entrar a una obra, cargar sus parámetros y avance desde Firestore
  useEffect(()=>{
    if(!obraId) return;
    fsGet(`obras/${obraId}/config/parametros`).then(d=>{
      if(d) setObras(oo=>oo.map(o=>o.id===obraId?{...o,...d}:o));
    });
    fsGet(`obras/${obraId}/avance/subs`).then(d=>{
      if(d&&Array.isArray(d.data)){
        setSubs(ss=>ss.map(s=>{
          const saved=d.data.find(x=>x.sec===s.sec);
          return saved?{...s,a:saved.a}:s;
        }));
      }
    });
    fsGet(`obras/${obraId}/avance/maquinaria`).then(d=>{
      if(d&&Array.isArray(d.data)) setMaquinaria(d.data);
    });
    fsGet(`obras/${obraId}/avance/materiales`).then(d=>{
      if(d&&Array.isArray(d.data)) setMateriales(d.data);
    });
  },[obraId]);
  const[subs,setSubs]=useState(SUBS_INIT);
  const[maquinaria,setMaquinaria]=useState([
    {id:1,desc:"Retroexcavadora CAT-416D",vol:2,und:"Mes",pu:70000,imp:140000},
    {id:2,desc:"Compactador BOMAG BW120", vol:2,und:"Mes",pu:35000,imp:70000},
    {id:3,desc:"",vol:"",und:"Mes",pu:"",imp:0},
    {id:4,desc:"",vol:"",und:"Mes",pu:"",imp:0},
    {id:5,desc:"",vol:"",und:"Mes",pu:"",imp:0},
  ]);
  const[materiales,setMateriales]=useState([
    {id:1,desc:"Tubería PEAD 18\"",      concepto:"En almacén",    vol:120,und:"ML", pu:2322.41,imp:278689},
    {id:2,desc:"Piso recinto negro 10×10cm",concepto:"En tránsito",  vol:850,und:"M2", pu:3652.58,imp:3104693},
    {id:3,desc:"Bolardos acero inoxidable",concepto:"En fabricación",vol:120,und:"PZA",pu:19562,  imp:2347440},
    {id:4,desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0},
    {id:5,desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0},
  ]);
  const[estimaciones,setEstimaciones]=useState(EST_DEFAULT.map(e=>({...e})));
  const[estCargadas,setEstCargadas]=useState(false);

  // Cargar estimaciones desde Firestore al entrar a una obra
  useEffect(()=>{
    if(!obraId||estCargadas) return;
    fsGet(`obras/${obraId}/config/estimaciones`).then(d=>{
      if(d&&Array.isArray(d.data)) setEstimaciones(d.data);
      setEstCargadas(true);
    });
  },[obraId]);

  if(!usuario) return <><style>{css}</style><Login onLogin={u=>{setUsuario(u);}}/></>;

  const obra=obras.find(o=>o.id===obraId);
  const setObra=u=>setObras(oo=>oo.map(o=>o.id===u.id?u:o));
  const entrar=id=>{setObraId(id);setScreen("obra");setTab("dash");};
  const volver=()=>{setScreen("obras");setObraId(null);};
  const logout=async()=>{
    try { await signOut(fbAuth); } catch {}
    setUsuario(null); setScreen("obras"); setObraId(null);
  };
  const TABS=TABS_POR_ROL[usuario.rol]||TABS_POR_ROL.director_operaciones;

  return <ErrorBoundary><>
    <style>{css}</style>
    {/* HEADER */}
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"8px 14px",
      display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
      position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <EmblemaFOSMON size={22} dark={true}/>
        <div>
          <div style={{fontSize:14,fontWeight:700,letterSpacing:"0.12em",color:C.textPri,lineHeight:1}}>CAMPO</div>
          <div style={{fontSize:7,color:C.textMut,letterSpacing:"0.08em",marginTop:1}}>FOSMON CONSTRUCCIONES</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        {screen==="obra"&&obra&&<span style={{fontSize:9,color:C.textMut,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{obra.contrato}</span>}
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:C.textSec}}>{usuario.nombre.split(" ")[0]}</div>
          <div style={{fontSize:8,color:C.textMut}}>{ROL_LABEL[usuario.rol]}</div>
        </div>
        <button onClick={logout} style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:6,
          padding:"4px 8px",fontSize:10,color:C.textMut,cursor:"pointer"}}>Salir</button>
      </div>
    </div>

    {screen==="obra"&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
      background:C.surface,borderBottom:`0.5px solid ${C.border}`}}>
      <button onClick={()=>{
        if(cambiosPendientes){
          if(!window.confirm("Tienes cambios sin guardar en Capturar avance.\n\n¿Seguro que quieres salir? Los cambios se perderán si no los guardaste."))
            return;
        }
        setCambiosPendientes(false); volver();
      }} style={{background:"none",border:"none",padding:"7px 14px",
        fontSize:11,color:C.textSec,cursor:"pointer"}}>← Volver a obras</button>
      {cambiosPendientes&&<span style={{fontSize:9,color:C.yellow,display:"flex",alignItems:"center",
        gap:4,background:"rgba(202,138,4,0.12)",borderRadius:4,padding:"3px 8px",
        border:"0.5px solid rgba(202,138,4,0.25)"}}>
        ● Cambios sin guardar
      </span>}
      {obra&&<button onClick={()=>generarPDFObra(obra,subs,estimaciones,maquinaria,materiales)}
        style={{background:C.blueDk,border:"none",borderRadius:6,
          margin:"4px 12px",padding:"4px 10px",fontSize:10,color:"white",cursor:"pointer",
          display:"flex",alignItems:"center",gap:5}}>
        Generar PDF
      </button>}
    </div>}

    {screen==="obra"&&<div className="noscroll" style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
      display:"flex",overflowX:"auto",padding:"0 12px"}}>
      {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",
        borderBottom:`2px solid ${tab===t.id?C.blueDk:"transparent"}`,padding:"8px 12px",fontSize:11,
        color:tab===t.id?C.blueDk:C.textSec,cursor:"pointer",whiteSpace:"nowrap",
        fontWeight:tab===t.id?500:400,letterSpacing:"0.01em",transition:"all .15s"}}>{t.label}</button>)}
    </div>}

    <div style={{maxWidth:980,margin:"0 auto",padding:"14px 14px 56px"}}>
      {screen==="obras"&&<PantallaObras onSelect={entrar} usuario={usuario} obras={obras} setObras={setObras} gpData={gpData} gpLoading={gpLoading} gpUltActualiz={gpUltActualiz} onRefreshGP={cargarGP}/>}
      {screen==="obra"&&tab==="dash"&&obra&&<Dashboard obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales} estimaciones={estimaciones}/>}
      {screen==="obra"&&tab==="captura"&&obra&&<Captura subs={subs}
        setSubs={v=>{setSubs(v);setCambiosPendientes(true);}}
        maquinaria={maquinaria}
        setMaquinaria={v=>{setMaquinaria(v);setCambiosPendientes(true);}}
        materiales={materiales}
        setMateriales={v=>{setMateriales(v);setCambiosPendientes(true);}}
        rol={usuario.rol} obra={obra}/>}
      {screen==="obra"&&tab==="gastos"&&obra&&<GastosGP obra={obra} maquinaria={maquinaria} rol={usuario.rol}/>}
      {screen==="obra"&&tab==="estimaciones"&&obra&&<Estimaciones obra={obra} setObra={setObra} estimaciones={estimaciones} setEstimaciones={setEstimaciones} rol={usuario.rol}/>}
      {screen==="obra"&&tab==="riesgo"&&obra&&<Riesgo obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales} estimaciones={estimaciones}/>}
      {screen==="obra"&&tab==="presupuesto"&&obra&&<Presupuesto obra={obra} setObra={setObra} rol={usuario.rol}/>}
      {screen==="obra"&&tab==="contrato"&&obra&&<Contrato obra={obra} setObra={setObra} rol={usuario.rol}/>}
    </div>

    {/* FOOTER */}
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.surface,
      borderTop:`1px solid ${C.border}`,padding:"5px 16px",
      display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:99,
      boxShadow:"0 -1px 4px rgba(0,0,0,0.04)"}}>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        <EmblemaFOSMON size={11} dark={true} opacity={0.5}/>
        <span style={{fontSize:9,color:C.textMut,letterSpacing:"0.02em"}}>
          CAMPO — Control de Avance, Maquinaria, Personal y Obra
        </span>
      </div>
      <span style={{fontSize:9,color:C.textMut}}>v1.0 · 2026</span>
    </div>
  </></ErrorBoundary>;
}
