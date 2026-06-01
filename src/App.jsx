import React, { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, addDoc, query, where, orderBy, limit, onSnapshot, updateDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
// ── GENERADOR DE PDF DESDE EL APP ────────────────────────────────────────
// branding (opcional): permite cambiar logo / nombre empresa / paleta para multi-tenancy futuro.
// Para FOSMON: queda con defaults. Para SaaS: pasar { logoBlanco, logoNegro, empresa, dominio }.
async function generarPDFObra(obra, subs, estimaciones, maquinaria, materiales, subcontratos = [], branding = {}) {
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
  // ── BRANDING (con defaults FOSMON) ────────────────────────────────────────
  // Para vender CAMPO a otra empresa: pasar { logoBlanco, logoNegro, empresa, dominio }
  const B = {
    logoBlanco: branding.logoBlanco || (typeof EMB_WHITE!=='undefined' ? EMB_WHITE : null),
    logoNegro:  branding.logoNegro  || (typeof EMB_NEGRO!=='undefined' ? EMB_NEGRO : null),
    empresa:    branding.empresa    || 'FOSMON Construcciones',
    empresaCorta: branding.empresaCorta || 'FOSMON',
    dominio:    branding.dominio    || 'campo-fosmon.netlify.app',
  };

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
    // Logo (branded)
    try { if(B.logoBlanco)
      doc.addImage(B.logoBlanco,'PNG',ML,2,6.9,8,'','FAST');
    } catch(e){}
    // Textos header
    st(K.wh); fs(9); fw('bold');
    T('CAMPO', ML+10, 5);
    fs(6.5); fw('normal');
    T(`Reporte ejecutivo · ${B.empresa}`, ML+10, 9.5);
    fs(8); fw('bold');
    T(obra.nombre||'', PW-MR, 5, {align:'right'});
    fs(6.5); fw('normal');
    T(`${obra.contrato||''} · ${hoy}`, PW-MR, 9.5, {align:'right'});
    // Footer (la página total se reescribe al final cuando ya conocemos totalPages)
    sf([232,234,240]); R(0,PH-FTR,PW,FTR);
    sf(K.ng); R(0,PH-FTR,PW,0.6);
    st(K.gmu); fs(6); fw('normal');
    T(`CAMPO — ${B.empresa} · Documento confidencial`, ML, PH-3.5);
    T(`Página ${pagNum}`, PW/2, PH-3.5, {align:'center'});
    T(B.dominio, PW-MR, PH-3.5, {align:'right'});
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
    // Combinar columnStyles del caller con cellWidth de colW
    const callerColStyles = opts.columnStyles || {};
    const mergedColStyles = {};
    colW.forEach((w,i)=>{
      mergedColStyles[i] = { cellWidth:w, ...(callerColStyles[i]||{}) };
    });
    const { columnStyles:_discard, ...restOpts } = opts;
    const base = {
      head:[head], body,
      startY: y,
      margin: {left:x, right:PW-x-tableW},
      tableWidth: tableW,
      rowPageBreak: 'avoid',
      styles: {
        fontSize:FS_TD, cellPadding:2.2,
        textColor:K.gtx, lineColor:K.gbd, lineWidth:0.2,
        font:'helvetica', fontStyle:'normal',
        overflow:'linebreak', minCellHeight:0,
      },
      headStyles: {
        fillColor:K.ng, textColor:K.wh,
        fontSize:FS_TH, fontStyle:'bold',
        cellPadding:2.2, minCellHeight:0,
      },
      alternateRowStyles: { fillColor:K.glt, textColor:K.gtx },
      columnStyles: mergedColStyles,
      ...restOpts,
    };
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

  // ── Estimaciones ─────────────────────────────────────────────────────────
  y=secHead('2  ESTIMACIONES AL CLIENTE', y);

  // Filtrar solo estimaciones con datos reales
  const estActivas=estimaciones.filter(e=>e.no&&e.monto>0);
  const aT=te*(obra.pctAnticipo||10)/100;
  const fgT=te*(obra.pctFondoGar||5)/100;

  // TABLA: 4 columnas que suman CW=251mm exacto
  // No(16) + Periodo(58) + Monto(48) + Estatus(36) + MtoEfectivo = 251
  const C0=16, C1=58, C2=48, C3=36, C4=CW-C0-C1-C2-C3;
  const EST_SC={'pagada':K.vk,'facturada':K.mk,'en proceso':K.ak2,'aprobada':K.vk};

  let estRows;
  if (estActivas.length > 0) {
    estRows = estActivas.map(e=>{
      const ef=e.monto*(1-(obra.pctAnticipo||10)/100-(obra.pctFondoGar||5)/100);
      return [
        `EST-${String(e.no).padStart(2,'0')}`,
        e.periodo||'',
        MXN(e.monto),
        e.estatus||'',
        MXN(ef),
      ];
    });
    estRows.push(['TOTAL','',MXN(te),'',MXN(te-aT-fgT)]);
  } else {
    // Sin estimaciones capturadas: mostrar renglón vacío con indicación
    estRows = [['—','Sin estimaciones capturadas','—','—','—']];
  }

  // Usar doc.autoTable directamente — sin wrapper, control total
  doc.autoTable({
    head:[['No.','Periodo','Monto bruto','Estatus','Mto. efectivo']],
    body: estRows,
    startY: y,
    margin: {left:ML, right:MR},
    tableWidth: CW,
    styles:{
      fontSize:FS_TD, cellPadding:2.5,
      textColor:K.gtx, lineColor:K.gbd, lineWidth:0.2,
      overflow:'linebreak', minCellHeight:0,
    },
    headStyles:{fillColor:K.ng,textColor:K.wh,fontSize:FS_TH,fontStyle:'bold',cellPadding:2.5},
    alternateRowStyles:{fillColor:K.glt,textColor:K.gtx},
    columnStyles:{
      0:{cellWidth:C0, halign:'center'},
      1:{cellWidth:C1, halign:'left'},
      2:{cellWidth:C2, halign:'right'},
      3:{cellWidth:C3, halign:'center'},
      4:{cellWidth:C4, halign:'right'},
    },
    didParseCell:(d)=>{
      const ri=d.row.index;
      // Fila TOTAL — fondo negro
      if(ri===estRows.length-1){
        d.cell.styles.fillColor=K.ng;
        d.cell.styles.textColor=K.wh;
        d.cell.styles.fontStyle='bold';
        return;
      }
      // Color de estatus
      if(d.column.index===3 && estActivas[ri]){
        const col=EST_SC[normEst(estActivas[ri].estatus||'')]||K.gtx;
        d.cell.styles.textColor=col;
        d.cell.styles.fontStyle='bold';
      }
    },
  });
  y=doc.lastAutoTable.finalY+4;

  // KPIs en fila horizontal debajo de la tabla
  y=kpiRow([
    ['Pagado',     MXN(pag), 'cobrado y liquidado',   K.vk],
    ['Por cobrar', MXN(pco), 'facturado + aprobado',  K.mk],
    ['En proceso', MXN(epc), 'en elaboración',         K.ak2],
    ['Total est.', MXN(te),  PCT(te/PPTO*100)+' contrato', K.ak],
  ], y);

  // ════════════════════════════════════════════════════════════════════════
  // PAG 3 — ALMACÉN + MAQUINARIA
  // (El avance físico detallado se ve mejor en la gráfica visual de la pág 4.
  // El catálogo completo de partidas puede tener cientos de renglones y no
  // aporta valor ejecutivo, por eso ya no se incluye aquí.)
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;

  // Variables compartidas que usan secciones siguientes (totales, ejecución)
  const subsActivos=subs.filter(s=>s.imp>0);
  const totImp=subsActivos.reduce((t,s)=>t+s.imp,0);
  const totEjec=subsActivos.reduce((t,s)=>t+(s.a/100)*s.imp,0);

  // ── Almacén + Maquinaria en 2 columnas ──────────────────────────────────
  y=secHead('3  ALMACÉN · MATERIALES EN TRÁNSITO · MAQUINARIA PROPIA', y);

  const LW5=CW*0.56, RW5=CW-LW5-5;
  // Si no hay materiales, mostrar un renglón vacío indicando que no se ha capturado
  const matBody = matActivos.length > 0
    ? [...matActivos.map(m=>[m.desc||'',m.concepto||'',m.vol||'',m.und||'',MXN(pf(m.imp))]),
       ['TOTAL ALMACÉN','','','',MXN(totAlm)]]
    : [['Sin materiales capturados','','','','—']];
  const yAM=autoT(
    ['Material','Condición','Vol.','Und','Importe'], matBody,
    [LW5*0.40,LW5*0.22,LW5*0.10,LW5*0.10,LW5*0.18],
    ML, y,
    {columnStyles:{2:{halign:'right'},4:{halign:'right'}},
     didParseCell:(d)=>{
       if(matActivos.length > 0 && d.row.index===matActivos.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
       if(matActivos.length === 0){
         d.cell.styles.textColor=K.gmu; d.cell.styles.fontStyle='italic';
       }
     }}
  );

  const maqBody = maqActivos.length > 0
    ? [...maqActivos.map(m=>[m.desc||'',m.vol||'',m.und||'',MXN(pf(m.imp))]),
       ['TOTAL MAQUINARIA','','',MXN(totMaq)]]
    : [['Sin maquinaria capturada','','','—']];
  const yMQ=autoT(
    ['Equipo','Cant.','Unidad','Importe'], maqBody,
    [RW5*0.62,RW5*0.12,RW5*0.11,RW5*0.15],
    ML+LW5+5, y,
    {columnStyles:{1:{halign:'center'},3:{halign:'right'}},
     didParseCell:(d)=>{
       if(maqActivos.length > 0 && d.row.index===maqActivos.length){
         d.cell.styles.fillColor=K.ng; d.cell.styles.textColor=K.wh; d.cell.styles.fontStyle='bold';
       }
       if(maqActivos.length === 0){
         d.cell.styles.textColor=K.gmu; d.cell.styles.fontStyle='italic';
       }
     }}
  );
  y=Math.max(yAM,yMQ);

  // ════════════════════════════════════════════════════════════════════════
  // PAG 4 — GRÁFICA VISUAL DE AVANCE (top partidas + comparativo)
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;
  y=secHead('4  GRÁFICA DE AVANCE FÍSICO', y);

  // KPIs resumen arriba
  const subsConAv = subs.filter(s=>s.imp>0);
  const subsCompletadas = subsConAv.filter(s=>s.a>=100).length;
  const subsEnProgreso  = subsConAv.filter(s=>s.a>0 && s.a<100).length;
  const subsSinIniciar  = subsConAv.filter(s=>s.a===0).length;
  // % "programado" = avance ideal en función del plazo transcurrido
  let pctProgIdeal = 0;
  if (obra.inicio && obra.fin) {
    const ini = new Date(obra.inicio), fn = new Date(obra.fin), hoy_ = new Date();
    const total = (fn - ini) / 86400000;
    const transc = Math.max(0, Math.min(total, (hoy_ - ini) / 86400000));
    pctProgIdeal = total > 0 ? (transc / total * 100) : 0;
  }
  const desviacion = af - pctProgIdeal;
  y=kpiRow([
    ['Avance real',     PCT(af),              `${subsConAv.length} partidas activas`, af>=75?K.vk:af>=40?K.am:K.rd],
    ['Avance programado', PCT(pctProgIdeal),  pctProgIdeal>0?'según plazo contractual':'sin fechas capturadas', K.ak],
    ['Desviación',      `${desviacion>=0?'+':''}${desviacion.toFixed(1)}%`,  desviacion>=0?'sobre programa':'bajo programa', desviacion>=0?K.vk:K.rk],
    ['Completadas',     `${subsCompletadas}`, `${subsEnProgreso} en curso · ${subsSinIniciar} sin iniciar`, K.mk],
  ], y)+3;

  // Top 9 partidas por importe — cabe dentro del área útil sin que la leyenda
  // choque con el footer (área útil = 165mm; 9 × 14mm + KPIs + header + leyenda = ~160mm)
  const top = [...subsConAv].sort((a,b)=>b.imp-a.imp).slice(0, 9);

  if (top.length === 0) {
    st(K.gmu); fs(10); fw('italic');
    T('No hay partidas con presupuesto cargado. Carga el catálogo en Planeación → Presupuesto.',
      ML+10, y+15);
  } else {
    // Layout: descripción a la izq, barra horizontal con marcador de "programado"
    const rowH = 14;             // suficiente aire para que % no toque siguiente fila
    const barX = ML + 110;       // donde empieza la barra
    const barW = CW - 110 - 30;  // ancho de la barra (30mm para etiqueta de %)
    const labelW = 105;          // ancho de la columna de descripción
    const maxDescChars = 42;     // truncar descripciones largas (en mayúsculas ocupan más)
    // Encabezado de la sección
    st(K.gmu); fs(7); fw('bold');
    T('PARTIDA', ML, y+4);
    T('AVANCE REAL VS PROGRAMADO', barX, y+4);
    T('%', barX+barW+12, y+4, {align:'center'});
    y += 7;
    sd(K.gbd); lw(0.3); L(ML, y, ML+CW, y);
    y += 3;

    top.forEach((s, idx) => {
      const pctReal = Math.min(100, s.a||0);
      const colReal = pctReal>=75?K.vd : pctReal>=40?K.am : K.rd;
      const colKReal = pctReal>=75?K.vk : pctReal>=40?K.ak2 : K.rk;

      // Clave (sec)
      st(K.ng); fs(7.5); fw('bold');
      T(s.sec || '—', ML, y+4.5);
      // Descripción truncada manualmente con "…" si excede
      st(K.gtx); fs(7); fw('normal');
      let descTxt = (s.sub || '').trim();
      if (descTxt.length > maxDescChars) descTxt = descTxt.slice(0, maxDescChars-1).trim() + '…';
      T(descTxt, ML+15, y+4.5);
      // Importe (más abajo)
      st(K.gmu); fs(6.5);
      T(MXN(s.imp), ML+15, y+8.5);

      // Fondo de la barra
      sf(K.glt); doc.rect(barX, y+2, barW, 5, 'F');
      sd(K.gbd); lw(0.15); doc.rect(barX, y+2, barW, 5, 'S');

      // Barra de avance real
      if (pctReal > 0) {
        sf(colReal); doc.rect(barX, y+2, barW * pctReal/100, 5, 'F');
      }

      // Marcador vertical de "% programado"
      if (pctProgIdeal > 0 && pctProgIdeal <= 100) {
        const xProg = barX + barW * pctProgIdeal/100;
        sd(K.na); lw(0.6);
        doc.line(xProg, y+1, xProg, y+8);
        sf(K.na); doc.triangle(xProg-1.2, y+1, xProg+1.2, y+1, xProg, y+2.2, 'F');
      }

      // Etiqueta de % al final
      st(colKReal); fs(9); fw('bold');
      T(`${pctReal.toFixed(0)}%`, barX+barW+12, y+6, {align:'center'});

      y += rowH;
      // Línea divisora: bien debajo del importe (no encima), entre filas
      if (idx < top.length-1) {
        sd(K.gbd); lw(0.1);
        L(ML, y-0.5, ML+CW, y-0.5);
      }
    });

    // Leyenda al pie del gráfico
    y += 4;
    sf(K.glt); sd(K.gbd); lw(0.2); R(ML, y, CW, 9, 'FD');
    st(K.gtx); fs(7); fw('normal');
    sf(K.vd); R(ML+4, y+3, 3, 3, 'F'); T('Avance 75% o más', ML+9, y+5.3);
    sf(K.am); R(ML+50, y+3, 3, 3, 'F'); T('40 a 74%', ML+55, y+5.3);
    sf(K.rd); R(ML+78, y+3, 3, 3, 'F'); T('Menos de 40%', ML+83, y+5.3);
    sf(K.na); doc.triangle(ML+112, y+3, ML+115.5, y+3, ML+113.7, y+5.5, 'F');
    T('Posición esperada según plazo', ML+118, y+5.3);
    st(K.gmu); fs(6.5);
    T(`Top ${top.length} partidas por importe (${MXN(top.reduce((t,s)=>t+s.imp,0))} de ${MXN(totImp)} total)`,
      PW-MR, y+5.3, {align:'right'});
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAG 5 — PROYECCIÓN Y PLAZOS
  // ════════════════════════════════════════════════════════════════════════
  doc.addPage(); pageFrame();
  y=CY0;
  y=secHead('5  PROYECCIÓN AL TÉRMINO · PLAZOS DE OBRA', y);

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
  y=secHead('6  PERSONAL EN CAMPO · NÓMINA · TOP PROVEEDORES', y);

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

  // Top 5 nómina (renglón vacío si no hay)
  const nom5=nomData.slice().sort((a,b)=>(b.total||0)-(a.total||0)).slice(0,5);
  const nomBody = nom5.length > 0
    ? nom5.map((pe,i)=>[
        i+1, pe.nombre||'', pe.categoria||pe.cat||'',
        `${(pe.horasExtra||0).toFixed(0)}h`, MXN(pe.total||0),
      ])
    : [['—','Sin nómina capturada','—','—','—']];
  const yNom=autoT(
    ['#','Trabajador','Categoría','HE hrs','Total semana'], nomBody,
    [8,LW7*0.44,LW7*0.28,LW7*0.12,LW7*0.16], ML, y,
    {columnStyles:{0:{halign:'center'},3:{halign:'right'},4:{halign:'right'}},
     didParseCell:(d)=>{
       if(nom5.length === 0){
         d.cell.styles.textColor=K.gmu; d.cell.styles.fontStyle='italic';
         return;
       }
       if(d.column.index===3){
         const he=parseFloat(d.cell.text[0])||0;
         d.cell.styles.textColor=he>=20?K.rk:K.ak2;
         d.cell.styles.fontStyle='bold';
       }
       if(d.column.index===4){d.cell.styles.fontStyle='bold';d.cell.styles.textColor=K.ng;}
     }}
  );

  // Top 5 proveedores — solo si hay datos reales de la obra
  const provs = Array.isArray(obra.proveedores) && obra.proveedores.length > 0
    ? obra.proveedores : [];
  const totPv = provs.reduce((t,p)=>t+p[1],0);
  // El % se calcula sobre el total de los proveedores mostrados (no contra totGP
  // de toda la obra, que puede ser muy distinto y producir porcentajes absurdos)
  const pvBody = provs.length > 0
    ? provs.map(([nm,mt],i) => [i+1, nm.slice(0,28), MXN(mt), PCT(totPv>0 ? mt/totPv*100 : 0)])
    : [['—','Sin datos en esta obra','—','—']];
  const yPv=autoT(
    ['#','Proveedor','Monto acumulado','% del top'], pvBody,
    [8,RW7*0.52,RW7*0.28,RW7*0.20], ML+LW7+5, y,
    {columnStyles:{0:{halign:'center'},2:{halign:'right'},3:{halign:'right'}},
     didParseCell:(d) => {
       if (provs.length === 0) {
         d.cell.styles.textColor = K.gmu;
         d.cell.styles.fontStyle = 'italic';
       }
     }}
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
  y=secHead('7  INDICADORES DE RIESGO · OBSERVACIONES', y);

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
  // RESUMEN EJECUTIVO DE SUBCONTRATOS (tabla compacta de todos)
  // Solo aparece si hay subcontratos. Va antes del detalle individual.
  // ════════════════════════════════════════════════════════════════════════
  if (subcontratos && subcontratos.length > 0) {
    doc.addPage(); pageFrame();
    y = CY0;
    y = secHead('RESUMEN EJECUTIVO DE SUBCONTRATOS', y);

    // KPIs resumen
    const totContratado = subcontratos.reduce((t,s)=>t+pf(s.monto), 0);
    const totEjecutado  = subcontratos.reduce((t,s)=>{
      const totCat = (s.conceptos||[]).reduce((tt,c)=>tt+pf(c.importe), 0);
      const ejec = (s.conceptos||[]).reduce((tt,c)=>tt+((pf(c.avance)/100)*pf(c.importe)), 0);
      return t + ejec;
    }, 0);
    const totPagado = subcontratos.reduce((t,s)=>
      t + (s.pagos||[]).filter(p=>p.estatus==='pagado').reduce((tt,p)=>tt+pf(p.monto), 0), 0);
    const activos = subcontratos.filter(s=>(s.estado||'activa')==='activa').length;

    y = kpiRow([
      ['Subcontratos',     `${subcontratos.length}`, `${activos} activos`, K.ng],
      ['Monto contratado', MXN(totContratado), 'suma de contratos',       K.ak],
      ['Ejecutado físico', MXN(totEjecutado),  totContratado>0?PCT(totEjecutado/totContratado*100)+' del total':'',  K.vk],
      ['Pagado',           MXN(totPagado),     totContratado>0?PCT(totPagado/totContratado*100)+' del total':'',     K.mo],
    ], y) + 3;

    // Tabla resumen de subcontratos
    const subRows = subcontratos.map(s => {
      const totCat = (s.conceptos||[]).reduce((t,c)=>t+pf(c.importe), 0);
      const ejec   = (s.conceptos||[]).reduce((t,c)=>t+((pf(c.avance)/100)*pf(c.importe)), 0);
      const avPct  = totCat > 0 ? (ejec/totCat)*100 : 0;
      const pag    = (s.pagos||[]).filter(p=>p.estatus==='pagado').reduce((t,p)=>t+pf(p.monto), 0);
      const finPct = pf(s.monto) > 0 ? (pag/pf(s.monto))*100 : 0;
      const pendiente = pf(s.monto) - pag;
      return [
        s.nombre || s.id || '—',
        s.proveedor || '—',
        (s.estado || 'activa').toUpperCase(),
        MXN(pf(s.monto)),
        PCT(avPct, 0),
        MXN(pag),
        PCT(finPct, 0),
        MXN(pendiente),
      ];
    });
    // Fila de totales
    subRows.push([
      '', 'TOTAL', '', MXN(totContratado), '',
      MXN(totPagado), '', MXN(totContratado - totPagado)
    ]);

    autoT(
      ['Subcontrato', 'Proveedor', 'Estado', 'Contratado', '% Avance', 'Pagado', '% Pagado', 'Por pagar'],
      subRows,
      [42, 50, 22, 30, 18, 30, 18, 41],
      ML, y,
      {
        bodyStyles: { fontSize: FS_TD - 0.5 },
        columnStyles: {
          2: { halign:'center', fontSize: FS_SM },
          3: { halign:'right' },
          4: { halign:'center', fontStyle:'bold' },
          5: { halign:'right' },
          6: { halign:'center' },
          7: { halign:'right', fontStyle:'bold' },
        },
        didParseCell: (d) => {
          const ri = d.row.index;
          // Fila TOTAL
          if (ri === subRows.length - 1) {
            d.cell.styles.fillColor = K.ng;
            d.cell.styles.textColor = K.wh;
            d.cell.styles.fontStyle = 'bold';
            return;
          }
          const s = subcontratos[ri];
          if (!s) return;
          // Color al % avance
          if (d.column.index === 4) {
            const av = parseFloat(d.cell.text[0]) || 0;
            d.cell.styles.textColor = av >= 75 ? K.vk : av >= 40 ? K.ak2 : K.rk;
          }
          // Color al estado
          if (d.column.index === 2) {
            const est = (s.estado || 'activa').toLowerCase();
            d.cell.styles.textColor =
              est === 'terminada' ? K.vk :
              est === 'pausada' ? K.ak2 :
              est === 'cancelada' ? K.rk : K.ak;
          }
        },
      }
    );
    y = doc.lastAutoTable.finalY + 4;

    // Nota al pie
    st(K.gmu); fs(7); fw('italic');
    T(`El detalle de cada subcontrato (catálogo y pagos) aparece en las hojas siguientes.`,
      ML, y+3);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGS — FOTOGRAFÍAS
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

  let yF2=drawFotoPage(fotos12.slice(0,6), '8  EVIDENCIA FOTOGRÁFICA (1 de 2)');
  drawFotoPage(fotos12.slice(6,12), '9  EVIDENCIA FOTOGRÁFICA (2 de 2)');

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

  // ════════════════════════════════════════════════════════════════════════
  // PÁGINAS DE SUBCONTRATOS — una por cada subcontrato registrado
  // ════════════════════════════════════════════════════════════════════════
  if (subcontratos && subcontratos.length > 0) {
    for (const sub of subcontratos) {
      doc.addPage();
      pageFrame();
      // Header de sección con nombre del sub
      let y = CY0;
      y = secHead(`SUBCONTRATO · ${sub.nombre || sub.id}`.toUpperCase(), y, K.ng);

      // KPIs del subcontrato
      const totalCat = (sub.conceptos||[]).reduce((t,c)=>t+pf(c.importe), 0);
      const ejecSub = (sub.conceptos||[]).reduce((t,c)=>t+((pf(c.avance)/100)*pf(c.importe)), 0);
      const avSub = totalCat > 0 ? (ejecSub/totalCat)*100 : 0;
      const pagSub = (sub.pagos||[]).filter(p=>p.estatus==='pagado').reduce((t,p)=>t+pf(p.monto), 0);
      const finSub = pf(sub.monto) > 0 ? (pagSub/pf(sub.monto))*100 : 0;
      y = kpiRow([
        ['Monto contratado', MXN(pf(sub.monto)), sub.proveedor||'Sin proveedor', K.ng],
        ['Total catálogo', MXN(totalCat), `${(sub.conceptos||[]).length} conceptos`, K.az],
        ['Ejecutado', MXN(ejecSub), `${PCT(avSub)} físico`, K.vd],
        ['Pagado', MXN(pagSub), `${PCT(finSub)} financiero`, K.mo],
      ], y);

      // Datos generales del sub
      y = secHead('Datos del subcontrato', y, K.gtx);
      const datosSub = [
        ['Proveedor', sub.proveedor||'—'],
        ['Estado', (sub.estado||'activa').toUpperCase()],
        ['Inicio', sub.fechaInicio||'—'],
        ['Fin', sub.fechaFin||'—'],
        ['Descripción', sub.descripcion||'—'],
      ];
      y = autoT(['Campo','Valor'], datosSub, [50, CW-50], ML, y, {
        bodyStyles: {fontSize: FS_SM},
      });

      // Catálogo de conceptos del sub (si caben)
      if ((sub.conceptos||[]).length > 0) {
        const yDisp = CYmax - y;
        if (yDisp > 30) {
          y = secHead('Catálogo de conceptos', y, K.gtx);
          const filas = sub.conceptos.map(c => [
            c.clave||'—',
            (c.desc||'').substring(0,60),
            c.unidad||'',
            (pf(c.cantidad)||0).toLocaleString('es-MX',{maximumFractionDigits:2}),
            MXN(pf(c.pu)),
            MXN(pf(c.importe)),
            PCT(pf(c.avance),0),
          ]);
          // colW: 25 + 100 + 18 + 25 + 30 + 35 + 18 = 251 (CW)
          y = autoT(
            ['Clave','Descripción','Und','Cant.','P.U.','Importe','Avance'],
            filas, [25, 100, 18, 25, 30, 35, 18], ML, y,
            {
              bodyStyles: {fontSize: FS_SM, halign:'left'},
              columnStyles: {
                3: {halign:'right'},
                4: {halign:'right'},
                5: {halign:'right', fontStyle:'bold'},
                6: {halign:'right', fontStyle:'bold'},
              },
            });
        }
      }

      // Pagos del sub (si hay y caben)
      if ((sub.pagos||[]).length > 0 && (CYmax - y) > 25) {
        y = secHead('Historial de pagos', y, K.gtx);
        const pagosFilas = sub.pagos.map(p => [
          p.fecha||'—',
          MXN(pf(p.monto)),
          (p.referencia||'').substring(0,60),
          (p.estatus||'programado').toUpperCase(),
        ]);
        // colW: 30 + 40 + 130 + 51 = 251
        y = autoT(
          ['Fecha','Monto','Referencia','Estatus'],
          pagosFilas, [30, 40, 130, 51], ML, y,
          {
            bodyStyles: {fontSize: FS_SM},
            columnStyles: {
              1: {halign:'right', fontStyle:'bold'},
              3: {halign:'center'},
            },
          });
      }
    }
  }

  // ── PIE DE PÁGINA CON TOTAL DE PÁGINAS ──────────────────────────────────
  // Sobrescribe "Página X" por "Página X de N" ahora que conocemos el total
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    // Cubrir el texto anterior con fondo del footer y rescribir
    sf([232,234,240]); R(PW/2-25, PH-6, 50, 4, 'F');
    st(K.gmu); fs(6); fw('normal');
    T(`Página ${i} de ${totalPaginas}`, PW/2, PH-3.5, {align:'center'});
  }

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
const fbFn   = getFunctions(fbApp, "us-central1");

// Helpers para llamar Cloud Functions (gestión de usuarios)
const callFn = async (name, data) => {
  try {
    const fn = httpsCallable(fbFn, name);
    const res = await fn(data || {});
    return { ok: true, data: res.data };
  } catch (e) {
    console.error(`callFn(${name})`, e);
    return { ok: false, error: e.message || String(e), code: e.code };
  }
};

// Helpers Firestore
const fsGet  = async (path) => { try { const d = await getDoc(doc(fbDb, ...path.split('/'))); return d.exists() ? d.data() : null; } catch { return null; } };
const fsSet  = async (path, data) => { try { await setDoc(doc(fbDb, ...path.split('/')), data, {merge:true}); return true; } catch(e) { console.error('fsSet',e); return false; } };
const fsDel  = async (path) => { try { await deleteDoc(doc(fbDb, ...path.split('/'))); return true; } catch { return false; } };
const fsColl = async (path) => { try { const s = await getDocs(collection(fbDb, ...path.split('/'))); return s.docs.map(d=>({id:d.id,...d.data()})); } catch { return []; } };

// ════════════════════════════════════════════════════════════════════════════
// AUDIT LOG (bitácora) — para resolver controversias y trazabilidad
// ════════════════════════════════════════════════════════════════════════════
// Estructura Firestore: auditoria/{autoId} con tipo, usuario, obra, módulo,
// entidad, path, antes, después, ts. Helpers fsSetA / fsDelA envuelven los
// writes para registrar automáticamente.
let _auditCtx = { correo:"anonimo", nombre:"", rol:"", obraId:null, obraNombre:"" };
const setAuditCtx = (ctx) => { _auditCtx = { ..._auditCtx, ...ctx }; };
const setAuditObra = (id, nombre) => { _auditCtx.obraId = id; _auditCtx.obraNombre = nombre || ""; };

// Trunca snapshots para no llenar la bitácora con fotos en base64 o listas enormes
const _trunc = (v, depth=0) => {
  if (v === null || v === undefined) return v;
  if (depth > 3) return "…";
  if (typeof v === "string") return v.length > 200 ? v.slice(0,200) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => _trunc(x, depth+1));
  if (typeof v === "object") {
    const o = {};
    Object.keys(v).slice(0, 30).forEach(k => {
      if (k === "url" && typeof v[k] === "string" && v[k].startsWith("data:")) o[k] = "[base64 omitido]";
      else if (k === "fotos" && Array.isArray(v[k])) o[k] = `[${v[k].length} foto(s)]`;
      else o[k] = _trunc(v[k], depth+1);
    });
    return o;
  }
  return String(v);
};

async function fsAudit(tipo, opciones = {}) {
  try {
    const entry = {
      tipo,
      usuario: _auditCtx.correo || "anonimo",
      nombre: _auditCtx.nombre || "",
      rol: _auditCtx.rol || "",
      obraId: opciones.obraId !== undefined ? opciones.obraId : _auditCtx.obraId,
      obraNombre: opciones.obraNombre !== undefined ? opciones.obraNombre : _auditCtx.obraNombre,
      modulo: opciones.modulo || "",
      entidad: opciones.entidad || "",
      path: opciones.path || "",
      ts: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "",
    };
    if (opciones.antes !== undefined) entry.antes = _trunc(opciones.antes);
    if (opciones.despues !== undefined) entry.despues = _trunc(opciones.despues);
    if (opciones.meta) entry.meta = _trunc(opciones.meta);
    await addDoc(collection(fbDb, "auditoria"), entry);
  } catch(e) { console.warn("fsAudit fallo (silencioso):", e?.message); }
}

// Wrappers con auditoría. Si no se pasa ctx, no se audita.
const fsSetA = async (path, data, ctx) => {
  let antes = null;
  if (ctx) { try { antes = await fsGet(path); } catch {} }
  const ok = await fsSet(path, data);
  if (ok && ctx) {
    fsAudit(antes ? "editar" : "crear", {
      path, modulo: ctx.modulo, entidad: ctx.entidad,
      obraId: ctx.obraId, obraNombre: ctx.obraNombre,
      antes, despues: data, meta: ctx.meta,
    });
  }
  return ok;
};
const fsDelA = async (path, ctx) => {
  let antes = null;
  if (ctx) { try { antes = await fsGet(path); } catch {} }
  const ok = await fsDel(path);
  if (ok && ctx) {
    fsAudit("borrar", {
      path, modulo: ctx.modulo, entidad: ctx.entidad,
      obraId: ctx.obraId, obraNombre: ctx.obraNombre,
      antes, meta: ctx.meta,
    });
  }
  return ok;
};

// ════════════════════════════════════════════════════════════════════════════
// HISTÓRICO SEMANAL DE AVANCE
// ════════════════════════════════════════════════════════════════════════════
// Estructura Firestore: obras/{obraId}/avance/historial = { semanas: [...] }
// Cada snapshot: { id, semana, año, fechaCaptura, fechaCierre, tipo (intermedio/oficial),
//                  capturadoPor, subs: [{sec, a, imp}], avancePonderado, montoEjecutado }

// Calcula el número ISO de semana ISO 8601 (semana que contiene el primer jueves del año)
const semanaISO = (fecha) => {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  // Jueves de esta semana (semana ISO está definida por el jueves)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const inicioAño = new Date(d.getFullYear(), 0, 1);
  return {
    semana: Math.ceil(((d - inicioAño) / 86400000 + 1) / 7),
    año: d.getFullYear(),
  };
};

// ID de snapshot: S{semana}-{año} ej. "S22-2026"
const snapshotId = (semana, año) => `S${String(semana).padStart(2,'0')}-${año}`;

// Crear snapshot del avance actual y guardarlo en el historial
// tipo: "intermedio" (guardado normal) | "oficial" (cierre formal de viernes)
const crearSnapshotAvance = async (obraId, subs, capturadoPor, tipo = "intermedio") => {
  if (!obraId || !Array.isArray(subs) || subs.length === 0) return null;
  try {
    const ahora = new Date();
    const { semana, año } = semanaISO(ahora);
    const id = snapshotId(semana, año);
    const totalImporte = subs.reduce((t, s) => t + (s.imp || 0), 0);
    const avancePonderado = totalImporte > 0
      ? subs.reduce((t, s) => t + ((s.a || 0) / 100) * ((s.imp || 0) / totalImporte) * 100, 0)
      : 0;
    const montoEjecutado = subs.reduce((t, s) => t + ((s.a || 0) / 100) * (s.imp || 0), 0);
    const snap = {
      id, semana, año,
      fechaCaptura: ahora.toISOString(),
      fechaCierre: tipo === "oficial" ? ahora.toISOString() : null,
      tipo, capturadoPor: capturadoPor || 'sistema',
      subs: subs.map(s => ({sec: s.sec, sub: s.sub, a: s.a || 0, imp: s.imp || 0})),
      avancePonderado, montoEjecutado,
    };
    // Leer historial actual, hacer upsert por id (semana actual sobrescribe el snapshot intermedio)
    const hist = await fsGet(`obras/${obraId}/avance/historial`) || { semanas: [] };
    const semanas = (hist.semanas || []).slice();
    const idx = semanas.findIndex(s => s.id === id);
    // Si ya hay un oficial guardado, no sobrescribir con intermedio
    if (idx >= 0) {
      if (semanas[idx].tipo === "oficial" && tipo !== "oficial") {
        return null; // ya está cerrado oficialmente, no tocamos
      }
      semanas[idx] = snap;
    } else {
      semanas.push(snap);
    }
    // Mantener máximo 52 semanas (1 año)
    semanas.sort((a, b) => (a.año - b.año) || (a.semana - b.semana));
    const recortadas = semanas.slice(-52);
    await fsSet(`obras/${obraId}/avance/historial`, { semanas: recortadas });
    return snap;
  } catch (e) {
    console.error('crearSnapshotAvance', e);
    return null;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// BIBLIOTECA DE RIESGOS
// ════════════════════════════════════════════════════════════════════════════
// Cada riesgo tiene un detector que recibe un contexto y devuelve null (no aplica)
// o un objeto {severidad, valor, detalle, extra} cuando se detecta.
//
// Contexto que reciben los detectores:
//   { obra, subs, maquinaria, materiales, estimaciones, subcontratos,
//     historialAvance, gpData, kpis }
//
// Categorías: financiero · plazo · avance · nomina · materiales · maquinaria
//             · subcontratos · contractual · compliance · cobranza
// Severidades: bajo · medio · alto · critico

const SEVERIDADES = {
  bajo:   {color:'#9AA0AC',   label:'Bajo',   peso: 1},
  medio:  {color:'#EF9F27',   label:'Medio',  peso: 2},
  alto:   {color:'#F43F5E',   label:'Alto',   peso: 3},
  critico:{color:'#E24B4A',   label:'Crítico',peso: 4},
};

const BIBLIOTECA_RIESGOS = [
  // ── FINANCIEROS ──
  {
    id: 'fin_001', categoria: 'financiero',
    titulo: 'Margen bruto en zona crítica',
    descripcion: 'El margen bruto está por debajo del umbral mínimo aceptable',
    tab: 'operacion', subTab: 'estimaciones',
    detect: ({kpis}) => {
      if (!kpis || kpis.me <= 0) return null;
      if (kpis.mpct < 0) return {severidad:'critico', valor:`${kpis.mpct.toFixed(1)}%`, detalle:'Margen negativo — se gasta más de lo que se ejecuta', extra:`Ejecutado ${MXN(kpis.me)} vs gastado ${MXN(kpis.gt)}`};
      if (kpis.mpct < 6) return {severidad:'alto', valor:`${kpis.mpct.toFixed(1)}%`, detalle:'Margen bajo el umbral crítico (6%)', extra:`Ejecutado ${MXN(kpis.me)} vs gastado ${MXN(kpis.gt)}`};
      if (kpis.mpct < 15) return {severidad:'medio', valor:`${kpis.mpct.toFixed(1)}%`, detalle:'Margen en vigilancia (15%)', extra:`Mantener atención`};
      return null;
    },
  },
  {
    id: 'fin_002', categoria: 'financiero',
    titulo: 'Brecha entre gasto y avance',
    descripcion: 'Se está gastando más rápido que el avance físico de la obra',
    tab: 'operacion', subTab: 'avance',
    detect: ({kpis}) => {
      if (!kpis) return null;
      if (kpis.brecha > 25) return {severidad:'critico', valor:`+${kpis.brecha.toFixed(1)}pp`, detalle:'Brecha muy alta — sobrecosto inminente', extra:`Gasto: ${kpis.pctGasto.toFixed(1)}% · Avance: ${kpis.af.toFixed(1)}%`};
      if (kpis.brecha > 15) return {severidad:'alto', valor:`+${kpis.brecha.toFixed(1)}pp`, detalle:'Gasto adelantado al avance', extra:`Revisar uso de presupuesto`};
      if (kpis.brecha > 8) return {severidad:'medio', valor:`+${kpis.brecha.toFixed(1)}pp`, detalle:'Brecha en vigilancia'};
      return null;
    },
  },
  {
    id: 'fin_003', categoria: 'cobranza',
    titulo: 'Estimaciones atrasadas en cobro',
    descripcion: 'Hay estimaciones facturadas vencidas según el plazo contractual',
    tab: 'operacion', subTab: 'estimaciones',
    detect: ({obra, estimaciones}) => {
      if (!estimaciones?.length) return null;
      const diasPago = obra.diasPago || 30;
      const hoy = new Date();
      const atrasadas = estimaciones.filter(e => {
        if (e.estatus !== 'Facturada' || !e.fechaFact) return false;
        const dias = Math.floor((hoy - new Date(e.fechaFact))/86400000);
        return dias > diasPago;
      });
      if (atrasadas.length === 0) return null;
      const totalAtras = atrasadas.reduce((t,e)=>t+(e.monto||0), 0);
      const maxDias = Math.max(...atrasadas.map(e => Math.floor((hoy - new Date(e.fechaFact))/86400000) - diasPago));
      const sev = maxDias > 30 ? 'critico' : maxDias > 15 ? 'alto' : 'medio';
      return {severidad: sev, valor: `${atrasadas.length}`, detalle: `${MXN(totalAtras)} sin cobrar fuera de plazo`, extra: `Máximo atraso: ${maxDias} días vs plazo de ${diasPago}`};
    },
  },
  {
    id: 'fin_004', categoria: 'cobranza',
    titulo: 'Concentración de cuentas por cobrar',
    descripcion: 'Mucho monto facturado pendiente de cobro vs lo cobrado',
    tab: 'operacion', subTab: 'estimaciones',
    detect: ({estimaciones}) => {
      if (!estimaciones?.length) return null;
      const total = estimaciones.reduce((t,e)=>t+(e.monto||0), 0);
      const porCob = estimaciones.filter(e => ['Facturada','Aprobada'].includes(e.estatus)).reduce((t,e)=>t+(e.monto||0), 0);
      if (total === 0) return null;
      const pct = porCob/total*100;
      if (pct > 70) return {severidad:'alto', valor:`${pct.toFixed(0)}%`, detalle:'Mucho monto sin cobrar del cliente', extra:`${MXN(porCob)} de ${MXN(total)} estimado`};
      if (pct > 50) return {severidad:'medio', valor:`${pct.toFixed(0)}%`, detalle:'Cobranza pendiente significativa'};
      return null;
    },
  },
  {
    id: 'fin_005', categoria: 'financiero',
    titulo: 'Anticipo no recuperado',
    descripcion: 'Falta amortizar mucho anticipo recibido del cliente',
    tab: 'operacion', subTab: 'estimaciones',
    detect: ({obra, estimaciones}) => {
      if (!estimaciones?.length || !obra.pctAnticipo) return null;
      const totalEst = estimaciones.reduce((t,e)=>t+(e.monto||0), 0);
      const amortizado = estimaciones.filter(e=>e.estatus==='Pagada').reduce((t,e)=>t+(e.monto*obra.pctAnticipo/100), 0);
      const porAmort = estimaciones.filter(e=>e.estatus!=='Pagada').reduce((t,e)=>t+(e.monto*obra.pctAnticipo/100), 0);
      const anticipoTotal = obra.presupuesto * (obra.pctAnticipo/100);
      const totalAmort = amortizado + porAmort;
      if (totalAmort < anticipoTotal * 0.5) return null; // solo alertar si ya amortizamos al menos 50%
      const pendiente = anticipoTotal - amortizado;
      if (pendiente > anticipoTotal * 0.7) return {severidad:'medio', valor: MXN(pendiente), detalle:'Anticipo pendiente de recuperar', extra:`Total contractual: ${MXN(anticipoTotal)}`};
      return null;
    },
  },
  {
    id: 'fin_006', categoria: 'financiero',
    titulo: 'Velocidad de quema insostenible',
    descripcion: 'A ritmo actual el presupuesto se agota antes del fin contractual',
    tab: 'gastos',
    detect: ({obra, gpData, kpis}) => {
      if (!obra.fin || !gpData?.obras || !kpis) return null;
      const obraGP = Object.values(gpData.obras).find(o => o.id === obra.id?.slice(0,4) || o.id === obra.gpId);
      if (!obraGP) return null;
      const semanas = gpData.semanasDisponibles || [];
      const ult4 = semanas.slice(-4);
      const sumUlt4 = ult4.reduce((t,s)=>t+(obraGP.semanas[s]||0), 0);
      const velocidad = ult4.length>0 ? sumUlt4/ult4.length : 0;
      if (velocidad <= 0) return null;
      const totalGastado = obraGP.grandTotal || 0;
      const restante = obra.presupuesto - totalGastado;
      if (restante <= 0) return {severidad:'critico', valor:'0 sem', detalle:'Presupuesto agotado', extra:`Gastado: ${MXN(totalGastado)}`};
      const semsAgotar = Math.ceil(restante/velocidad);
      const semsPlazo = Math.max(Math.floor((new Date(obra.fin) - new Date())/(86400000*7)), 0);
      if (semsAgotar < semsPlazo * 0.5) return {severidad:'critico', valor:`${semsAgotar} sem`, detalle:'Presupuesto se agota mucho antes del plazo', extra:`Quedan ${semsPlazo} sem de plazo`};
      if (semsAgotar < semsPlazo) return {severidad:'alto', valor:`${semsAgotar} sem`, detalle:'Presupuesto agotará antes del fin', extra:`Plazo: ${semsPlazo} sem`};
      return null;
    },
  },
  // ── PLAZOS ──
  {
    id: 'plz_001', categoria: 'plazo',
    titulo: 'Plazo contractual vencido',
    descripcion: 'La fecha fin del contrato (o última ampliación) ya pasó',
    tab: 'planeacion', subTab: 'contrato',
    detect: ({obra}) => {
      const fin = obra.finAmpliado || obra.fin;
      if (!fin) return null;
      const dias = Math.floor((Date.now() - new Date(fin))/86400000);
      if (dias > 0) return {severidad:'critico', valor:`+${dias}d`, detalle:'Plazo vencido sin ampliación', extra:`Fin contratado: ${fin}`};
      return null;
    },
  },
  {
    id: 'plz_002', categoria: 'plazo',
    titulo: 'Plazo a punto de vencer',
    descripcion: 'Quedan 30 días o menos para el fin contractual',
    tab: 'planeacion', subTab: 'contrato',
    detect: ({obra}) => {
      const fin = obra.finAmpliado || obra.fin;
      if (!fin) return null;
      const dias = Math.floor((new Date(fin) - Date.now())/86400000);
      if (dias <= 0 || dias > 30) return null;
      const sev = dias <= 7 ? 'alto' : dias <= 15 ? 'medio' : 'bajo';
      return {severidad: sev, valor:`${dias}d`, detalle:`Quedan ${dias} días para el cierre`, extra:`Fecha fin: ${fin}`};
    },
  },
  {
    id: 'plz_003', categoria: 'plazo',
    titulo: 'No terminará en plazo a ritmo actual',
    descripcion: 'Proyección con velocidad histórica no alcanza el 100% en fecha fin',
    tab: 'operacion', subTab: 'avance',
    detect: ({obra, historialAvance}) => {
      if (!historialAvance?.length || !obra.fin) return null;
      const oficiales = historialAvance.filter(s => s.tipo === 'oficial');
      if (oficiales.length < 2) return null;
      const ult4 = oficiales.slice(-4);
      const totalDelta = ult4[ult4.length-1].avancePonderado - ult4[0].avancePonderado;
      const velocidad = (ult4.length-1) > 0 ? totalDelta/(ult4.length-1) : 0;
      if (velocidad <= 0) return null;
      const ultimo = oficiales[oficiales.length-1];
      const pendientes = Math.max(100 - ultimo.avancePonderado, 0);
      const semsNecesarias = pendientes/velocidad;
      const semsPlazo = Math.max(Math.floor((new Date(obra.finAmpliado||obra.fin) - Date.now())/(86400000*7)), 0);
      if (semsNecesarias > semsPlazo * 1.3) return {severidad:'critico', valor:`${(semsNecesarias-semsPlazo).toFixed(0)}sem`, detalle:'Terminará muy tarde a ritmo actual', extra:`Velocidad: ${velocidad.toFixed(2)}pp/sem`};
      if (semsNecesarias > semsPlazo) return {severidad:'alto', valor:`+${(semsNecesarias-semsPlazo).toFixed(0)}sem`, detalle:'Necesita acelerar para terminar en plazo'};
      return null;
    },
  },
  // ── AVANCE FÍSICO ──
  {
    id: 'avc_001', categoria: 'avance',
    titulo: 'Frentes sin iniciar',
    descripcion: 'Hay subsecciones que no han empezado ejecución',
    tab: 'operacion', subTab: 'avance',
    detect: ({subs}) => {
      if (!subs?.length) return null;
      const sinIni = subs.filter(s => (s.a||0) === 0);
      if (sinIni.length === 0) return null;
      const sev = sinIni.length > 5 ? 'alto' : sinIni.length > 2 ? 'medio' : 'bajo';
      return {severidad: sev, valor: `${sinIni.length}`, detalle: 'Subsecciones sin iniciar', extra: sinIni.slice(0,3).map(s=>s.sec).join(', ')+(sinIni.length>3?'...':'')};
    },
  },
  {
    id: 'avc_002', categoria: 'avance',
    titulo: 'Partidas estancadas',
    descripcion: 'Subsecciones con avance entre 1-99% sin movimiento ≥2 semanas',
    tab: 'operacion', subTab: 'avance',
    detect: ({subs, historialAvance}) => {
      if (!subs?.length || !historialAvance?.length) return null;
      const oficiales = historialAvance.filter(s => s.tipo === 'oficial');
      if (oficiales.length < 2) return null;
      const penultimo = oficiales[oficiales.length-2];
      const penMap = Object.fromEntries((penultimo.subs||[]).map(s=>[s.sec, s.a]));
      const estancadas = subs.filter(s => {
        const ant = penMap[s.sec];
        if (ant === undefined) return false;
        return (s.a||0) > 0 && (s.a||0) < 100 && (s.a||0) === ant;
      });
      if (estancadas.length === 0) return null;
      const sev = estancadas.length > 3 ? 'alto' : estancadas.length > 1 ? 'medio' : 'bajo';
      return {severidad: sev, valor: `${estancadas.length}`, detalle: 'Sin avance ≥2 semanas', extra: estancadas.slice(0,3).map(s=>s.sec).join(', ')};
    },
  },
  {
    id: 'avc_003', categoria: 'avance',
    titulo: 'Partidas con retroceso',
    descripcion: 'Subsecciones donde el % bajó vs semana anterior',
    tab: 'operacion', subTab: 'avance',
    detect: ({subs, historialAvance}) => {
      if (!subs?.length || !historialAvance?.length) return null;
      const oficiales = historialAvance.filter(s => s.tipo === 'oficial');
      if (oficiales.length < 1) return null;
      const ultimo = oficiales[oficiales.length-1];
      const ultMap = Object.fromEntries((ultimo.subs||[]).map(s=>[s.sec, s.a]));
      const retros = subs.filter(s => {
        const ant = ultMap[s.sec];
        return ant !== undefined && (s.a||0) < ant - 1;
      });
      if (retros.length === 0) return null;
      return {severidad:'alto', valor: `${retros.length}`, detalle: 'Posibles correcciones o re-trabajo', extra: retros.slice(0,3).map(s=>s.sec).join(', ')};
    },
  },
  {
    id: 'avc_004', categoria: 'avance',
    titulo: 'Avance vs plazo desbalanceado',
    descripcion: 'El % de plazo transcurrido supera mucho al % de avance',
    tab: 'operacion', subTab: 'avance',
    detect: ({obra, kpis}) => {
      if (!obra.inicio || !obra.fin || !kpis) return null;
      const finVigente = obra.finAmpliado || obra.fin;
      const total = (new Date(finVigente) - new Date(obra.inicio))/86400000;
      const trans = Math.max((Date.now() - new Date(obra.inicio))/86400000, 0);
      const pctPlazo = Math.min(trans/total*100, 100);
      const desv = pctPlazo - kpis.af;
      if (desv > 30) return {severidad:'critico', valor:`-${desv.toFixed(0)}pp`, detalle:'Plazo muy adelantado al avance', extra:`${pctPlazo.toFixed(0)}% plazo vs ${kpis.af.toFixed(0)}% avance`};
      if (desv > 20) return {severidad:'alto', valor:`-${desv.toFixed(0)}pp`, detalle:'Avance rezagado vs plazo'};
      if (desv > 10) return {severidad:'medio', valor:`-${desv.toFixed(0)}pp`, detalle:'Avance ligeramente rezagado'};
      return null;
    },
  },
  // ── NÓMINA ──
  {
    id: 'nom_001', categoria: 'nomina',
    titulo: 'Trabajadores con horas extra excesivas',
    descripcion: 'Personal con ≥20 horas extra por semana',
    tab: 'operacion', subTab: 'nomina',
    detect: () => {
      const altasHE = NOMINA_S18.filter(p => p.horasExtra >= 20);
      if (altasHE.length === 0) return null;
      const sev = altasHE.length > 10 ? 'alto' : altasHE.length > 5 ? 'medio' : 'bajo';
      return {severidad: sev, valor: `${altasHE.length}`, detalle: 'Riesgo de fatiga y sobrecosto', extra: altasHE.slice(0,3).map(p=>`${p.nombre.split(' ')[0]}: ${p.horasExtra}h`).join(' · ')};
    },
  },
  {
    id: 'nom_002', categoria: 'nomina',
    titulo: 'Costo de horas extra alto',
    descripcion: 'Las horas extra superan el 15% del total de nómina',
    tab: 'operacion', subTab: 'nomina',
    detect: () => {
      const totalNom = NOMINA_S18.reduce((t,p)=>t+(p.total||0), 0);
      const totalHE = NOMINA_S18.reduce((t,p)=>t+(p.importeHE||0), 0);
      if (totalNom === 0) return null;
      const pct = totalHE/totalNom*100;
      if (pct > 25) return {severidad:'alto', valor:`${pct.toFixed(0)}%`, detalle:'Costo HE muy alto', extra:`${MXN(totalHE)} de ${MXN(totalNom)} nómina`};
      if (pct > 15) return {severidad:'medio', valor:`${pct.toFixed(0)}%`, detalle:'Costo HE elevado'};
      return null;
    },
  },
  {
    id: 'nom_003', categoria: 'nomina',
    titulo: 'Posibles anomalías en cálculo',
    descripcion: 'Trabajadores con total >2.5× su salario base',
    tab: 'operacion', subTab: 'nomina',
    detect: () => {
      const anom = NOMINA_S18.filter(p => p.salarioSemanal>0 && p.total > p.salarioSemanal*2.5);
      if (anom.length === 0) return null;
      return {severidad:'medio', valor: `${anom.length}`, detalle: 'Verificar cálculo o caso especial', extra: anom.slice(0,3).map(p=>p.nombre.split(' ')[0]).join(', ')};
    },
  },
  // ── MATERIALES / ALMACÉN ──
  {
    id: 'mat_001', categoria: 'materiales',
    titulo: 'Material en tránsito por mucho tiempo',
    descripcion: 'Material marcado como En tránsito sin actualización',
    tab: 'operacion', subTab: 'almacen',
    detect: ({materiales}) => {
      const transito = (materiales||[]).filter(m => m.concepto === 'En tránsito' && (m.imp||0) > 0);
      if (transito.length === 0) return null;
      const total = transito.reduce((t,m)=>t+(m.imp||0), 0);
      return {severidad: total > 1000000 ? 'medio':'bajo', valor: `${transito.length}`, detalle: 'Verificar tiempos de entrega', extra: MXN(total)+' en tránsito'};
    },
  },
  {
    id: 'mat_002', categoria: 'materiales',
    titulo: 'Material en fabricación pendiente',
    descripcion: 'Material en proceso de fabricación con tiempo de espera',
    tab: 'operacion', subTab: 'almacen',
    detect: ({materiales}) => {
      const fab = (materiales||[]).filter(m => m.concepto === 'En fabricación' && (m.imp||0) > 0);
      if (fab.length === 0) return null;
      const total = fab.reduce((t,m)=>t+(m.imp||0), 0);
      return {severidad: total > 2000000 ? 'medio':'bajo', valor: `${fab.length}`, detalle: 'Tiempos de fabricación pueden impactar', extra: MXN(total)+' en fabricación'};
    },
  },
  // ── MAQUINARIA ──
  {
    id: 'maq_001', categoria: 'maquinaria',
    titulo: 'Costo de maquinaria alto vs presupuesto',
    descripcion: 'La maquinaria propia representa más del 8% del presupuesto',
    tab: 'operacion', subTab: 'maquinaria',
    detect: ({obra, maquinaria}) => {
      if (!obra.presupuesto || !maquinaria?.length) return null;
      const total = maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
      const pct = total/obra.presupuesto*100;
      if (pct > 15) return {severidad:'alto', valor:`${pct.toFixed(1)}%`, detalle:'Costo maquinaria muy alto', extra: MXN(total)};
      if (pct > 8) return {severidad:'medio', valor:`${pct.toFixed(1)}%`, detalle:'Revisar uso de maquinaria propia'};
      return null;
    },
  },
  // ── SUBCONTRATOS ──
  {
    id: 'sub_001', categoria: 'subcontratos',
    titulo: 'Subcontratos con desfase obra vs pago',
    descripcion: 'Subcontratistas con >20pp de diferencia entre avance físico y pago',
    tab: 'operacion', subTab: 'subcontratos',
    detect: ({subcontratos}) => {
      if (!subcontratos?.length) return null;
      const desfasados = subcontratos.filter(s => {
        const totalCat = s.conceptos?.reduce((t,c)=>t+(c.importe||0),0) || 0;
        const ejec = s.conceptos?.reduce((t,c)=>t+((c.avance||0)/100)*(c.importe||0),0) || 0;
        const pctF = totalCat > 0 ? ejec/totalCat*100 : 0;
        const pagado = s.pagos?.filter(p=>p.estatus==='pagado').reduce((t,p)=>t+(p.monto||0), 0) || 0;
        const pctFin = s.monto > 0 ? pagado/s.monto*100 : 0;
        return pctF > 0 && (pctF - pctFin) > 20;
      });
      if (desfasados.length === 0) return null;
      return {severidad:'medio', valor:`${desfasados.length}`, detalle:'Sub ejecutó más que lo pagado', extra: desfasados.slice(0,3).map(s=>s.nombre).join(', ')};
    },
  },
  {
    id: 'sub_002', categoria: 'subcontratos',
    titulo: 'Subcontratos con catálogo no cuadrado',
    descripcion: 'Suma del catálogo difiere >5% del monto contratado',
    tab: 'operacion', subTab: 'subcontratos',
    detect: ({subcontratos}) => {
      if (!subcontratos?.length) return null;
      const sinCuadrar = subcontratos.filter(s => {
        if (!s.monto || !s.conceptos?.length) return false;
        const totalCat = s.conceptos.reduce((t,c)=>t+(c.importe||0), 0);
        const dif = Math.abs(totalCat - s.monto) / s.monto * 100;
        return dif > 5;
      });
      if (sinCuadrar.length === 0) return null;
      return {severidad:'medio', valor:`${sinCuadrar.length}`, detalle:'Cuadrar catálogo con monto contratado', extra: sinCuadrar.slice(0,3).map(s=>s.nombre).join(', ')};
    },
  },
  {
    id: 'sub_003', categoria: 'subcontratos',
    titulo: 'Pagos programados pendientes',
    descripcion: 'Subs con pagos programados a punto de ejecutarse',
    tab: 'operacion', subTab: 'subcontratos',
    detect: ({subcontratos}) => {
      if (!subcontratos?.length) return null;
      let totalProg = 0; let cuantos = 0;
      subcontratos.forEach(s => {
        const prog = s.pagos?.filter(p => p.estatus === 'programado') || [];
        if (prog.length > 0) cuantos++;
        totalProg += prog.reduce((t,p)=>t+(p.monto||0), 0);
      });
      if (cuantos === 0) return null;
      return {severidad:'bajo', valor: MXN(totalProg), detalle: 'Pagos programados pendientes de ejecutar', extra: `${cuantos} subcontrato(s)`};
    },
  },
  // ── GASTOS / PROVEEDORES ──
  {
    id: 'gst_001', categoria: 'financiero',
    titulo: 'Concentración de proveedores',
    descripcion: 'Top 3 proveedores concentran >55% del gasto',
    tab: 'gastos',
    detect: ({obra, gpData}) => {
      if (!gpData?.obras) return null;
      const obraGP = Object.values(gpData.obras).find(o => o.id === obra.id?.slice(0,4) || o.id === obra.gpId);
      if (!obraGP?.proveedores?.length) return null;
      const ord = [...obraGP.proveedores].sort((a,b)=>(b.total||0)-(a.total||0));
      const total = ord.reduce((t,p)=>t+(p.total||0), 0);
      if (total === 0) return null;
      const top3 = ord.slice(0,3).reduce((t,p)=>t+(p.total||0), 0);
      const pct = top3/total*100;
      if (pct > 70) return {severidad:'alto', valor:`${pct.toFixed(0)}%`, detalle:'Dependencia muy alta de 3 proveedores', extra: 'Diversificar'};
      if (pct > 55) return {severidad:'medio', valor:`${pct.toFixed(0)}%`, detalle:'Concentración alta de proveedores'};
      return null;
    },
  },
  {
    id: 'gst_002', categoria: 'financiero',
    titulo: 'Anomalía de gasto semanal',
    descripcion: 'Gasto de la última semana es >2× el promedio histórico',
    tab: 'gastos',
    detect: ({obra, gpData}) => {
      if (!gpData?.obras || !gpData.ultimaSemana) return null;
      const obraGP = Object.values(gpData.obras).find(o => o.id === obra.id?.slice(0,4) || o.id === obra.gpId);
      if (!obraGP) return null;
      const semanas = gpData.semanasDisponibles || [];
      if (semanas.length < 4) return null;
      const valores = semanas.map(s => obraGP.semanas[s]||0);
      const prom = valores.reduce((t,v)=>t+v, 0) / valores.length;
      const ult = obraGP.semanas[gpData.ultimaSemana] || 0;
      if (prom === 0 || ult === 0) return null;
      const ratio = ult/prom;
      if (ratio > 3) return {severidad:'alto', valor:`${ratio.toFixed(1)}x`, detalle:'Gasto semanal muy por arriba del promedio', extra: `${MXN(ult)} vs prom ${MXN(prom)}`};
      if (ratio > 2) return {severidad:'medio', valor:`${ratio.toFixed(1)}x`, detalle:'Gasto semanal anormal'};
      return null;
    },
  },
  {
    id: 'gst_003', categoria: 'financiero',
    titulo: 'Proveedores nuevos esta semana',
    descripcion: 'Proveedores que aparecen por primera vez',
    tab: 'gastos',
    detect: ({obra, gpData}) => {
      if (!gpData?.obras || !gpData.ultimaSemana) return null;
      const obraGP = Object.values(gpData.obras).find(o => o.id === obra.id?.slice(0,4) || o.id === obra.gpId);
      if (!obraGP?.proveedores?.length) return null;
      const nuevos = obraGP.proveedores.filter(p => {
        const sems = Object.keys(p.semanas || {});
        return sems.length === 1 && sems[0] === gpData.ultimaSemana;
      });
      if (nuevos.length === 0) return null;
      const total = nuevos.reduce((t,p)=>t+(p.total||0), 0);
      return {severidad:'bajo', valor: `${nuevos.length}`, detalle: 'Verificar registro y autorización', extra: `${MXN(total)} en total`};
    },
  },
  {
    id: 'gst_004', categoria: 'financiero',
    titulo: 'Proveedor con incremento súbito',
    descripcion: 'Algún proveedor facturó >50% más vs semana anterior',
    tab: 'gastos',
    detect: ({obra, gpData}) => {
      if (!gpData?.obras || !gpData.ultimaSemana || !gpData.semanasDisponibles?.length) return null;
      const obraGP = Object.values(gpData.obras).find(o => o.id === obra.id?.slice(0,4) || o.id === obra.gpId);
      if (!obraGP?.proveedores?.length) return null;
      const idxU = gpData.semanasDisponibles.indexOf(gpData.ultimaSemana);
      if (idxU <= 0) return null;
      const semAnt = gpData.semanasDisponibles[idxU-1];
      const incs = obraGP.proveedores
        .map(p => {
          const ult = p.semanas[gpData.ultimaSemana] || 0;
          const ant = p.semanas[semAnt] || 0;
          if (ult <= 0 || ant <= 0) return null;
          return {nombre: p.nombre, ant, ult, pct: ((ult-ant)/ant)*100};
        })
        .filter(p => p && p.pct > 50);
      if (incs.length === 0) return null;
      return {severidad:'medio', valor: `${incs.length}`, detalle: 'Verificar autorización de incremento', extra: incs.slice(0,2).map(p=>`${p.nombre}: +${p.pct.toFixed(0)}%`).join(' · ')};
    },
  },
  {
    id: 'gst_005', categoria: 'financiero',
    titulo: 'Proveedores activos sin movimiento reciente',
    descripcion: 'Proveedores con gasto histórico sin facturar en 4+ semanas',
    tab: 'gastos',
    detect: ({obra, gpData}) => {
      if (!gpData?.obras || !gpData.semanasDisponibles?.length) return null;
      const obraGP = Object.values(gpData.obras).find(o => o.id === obra.id?.slice(0,4) || o.id === obra.gpId);
      if (!obraGP?.proveedores?.length) return null;
      const ult4 = gpData.semanasDisponibles.slice(-4);
      if (ult4.length < 4) return null;
      const inactivos = obraGP.proveedores.filter(p => {
        const sumU4 = ult4.reduce((t,s)=>t+(p.semanas[s]||0), 0);
        return p.total > 0 && sumU4 === 0;
      });
      if (inactivos.length === 0) return null;
      return {severidad:'bajo', valor: `${inactivos.length}`, detalle: 'Posible cierre de relación o trabajo detenido', extra: inactivos.slice(0,3).map(p=>p.nombre).join(', ')};
    },
  },
  // ── CONTRACTUALES ──
  {
    id: 'ctr_001', categoria: 'contractual',
    titulo: 'Días de pago no configurados',
    descripcion: 'No se ha definido el plazo contractual de pago de estimaciones',
    tab: 'planeacion', subTab: 'contrato',
    detect: ({obra}) => {
      if (obra.diasPago !== undefined && obra.diasPago > 0) return null;
      return {severidad:'bajo', valor: '—', detalle: 'Captura días de pago en Contrato', extra: 'Necesario para detectar atrasos'};
    },
  },
  {
    id: 'ctr_002', categoria: 'contractual',
    titulo: 'ID GP no vinculado',
    descripcion: 'La obra no tiene asignado el código de GP Construct',
    tab: 'planeacion', subTab: 'contrato',
    detect: ({obra, gpData}) => {
      if (obra.gpId) return null;
      if (/^\d{4}/.test(obra.id||'')) return null; // ya el id es 4 dígitos
      if (!gpData) return null;
      return {severidad:'medio', valor: '!', detalle: 'Sin esto no se ven gastos de GP', extra: 'Captura gpId en Contrato'};
    },
  },
  // ── COMPLIANCE ──
  {
    id: 'cmp_001', categoria: 'compliance',
    titulo: 'Sin presupuesto cargado',
    descripcion: 'No hay catálogo de presupuesto detallado para esta obra',
    tab: 'planeacion', subTab: 'presupuesto',
    detect: ({subs}) => {
      if (subs?.length > 0) return null;
      return {severidad:'medio', valor: '—', detalle: 'Sin catálogo no se puede medir avance', extra: 'Sube el Excel en Presupuesto'};
    },
  },
  {
    id: 'cmp_002', categoria: 'compliance',
    titulo: 'Sin cierres semanales registrados',
    descripcion: 'Aún no se ha cerrado ninguna semana',
    tab: 'operacion', subTab: 'avance',
    detect: ({historialAvance}) => {
      const oficiales = (historialAvance||[]).filter(s => s.tipo === 'oficial');
      if (oficiales.length > 0) return null;
      return {severidad:'bajo', valor: '0', detalle: 'Sin esto no hay tendencias ni proyecciones', extra: 'Botón "Cerrar semana"'};
    },
  },
];

// Motor de detección: evalúa todas las plantillas y devuelve las que disparen
const detectarRiesgos = (contexto) => {
  const detectados = [];
  for (const plantilla of BIBLIOTECA_RIESGOS) {
    try {
      const r = plantilla.detect(contexto);
      if (r) {
        detectados.push({
          ...plantilla,
          severidad: r.severidad,
          valor: r.valor,
          detalle: r.detalle,
          extra: r.extra,
        });
      }
    } catch(e) {
      // Detector con error: ignorar silenciosamente
    }
  }
  // Ordenar por severidad descendente
  detectados.sort((a,b) => (SEVERIDADES[b.severidad]?.peso||0) - (SEVERIDADES[a.severidad]?.peso||0));
  return detectados;
};

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICACIONES — Sistema in-app
// ════════════════════════════════════════════════════════════════════════════
// Estructura: notificaciones/{uid}/items/{notifId}
// Categorías: actividad · financiero · riesgo · plazo · gestion · resumen
// Cada notif tiene: tipo, categoria, titulo, mensaje, link {tab, subTab, obraId},
//                   leida (bool), archivada (bool), fecha (timestamp)

// Helper para crear una notif para uno o varios UIDs
const crearNotifPara = async (uids, {categoria, tipo, titulo, mensaje, link, creadaPor}) => {
  if (!Array.isArray(uids)) uids = [uids];
  uids = [...new Set(uids.filter(Boolean))]; // únicos, sin nulos
  if (uids.length === 0) return;
  try {
    const batch = writeBatch(fbDb);
    for (const uid of uids) {
      const ref = doc(collection(fbDb, `notificaciones/${uid}/items`));
      batch.set(ref, {
        categoria, tipo, titulo,
        mensaje: mensaje || '',
        link: link || {},
        leida: false,
        archivada: false,
        fecha: serverTimestamp(),
        creadaPor: creadaPor || 'sistema',
      });
    }
    await batch.commit();
  } catch (e) {
    console.error('crearNotifPara', e);
  }
};

// Helper: notificar a usuarios de uno o varios roles
// Lee la colección 'usuarios' filtrando por rol y activos
const notifARoles = async (roles, payload) => {
  if (!Array.isArray(roles)) roles = [roles];
  try {
    const q = query(collection(fbDb, 'usuarios'), where('rol', 'in', roles));
    const snap = await getDocs(q);
    const uids = snap.docs
      .map(d => d.data())
      .filter(u => u.activo !== false && u.uid)
      .map(u => u.uid);
    return crearNotifPara(uids, payload);
  } catch (e) {
    console.error('notifARoles', e);
  }
};

// Helper: notificar a un usuario específico por email
const notifAEmail = async (email, payload) => {
  if (!email) return;
  try {
    const emailId = email.toLowerCase().replace(/@/g,'_').replace(/\./g,'_');
    const perfilSnap = await getDoc(doc(fbDb, `usuarios/${emailId}`));
    if (!perfilSnap.exists()) return;
    const perfil = perfilSnap.data();
    if (perfil.activo === false || !perfil.uid) return;
    return crearNotifPara([perfil.uid], payload);
  } catch (e) {
    console.error('notifAEmail', e);
  }
};

// Marcar una notif como leída
const marcarNotifLeida = async (uid, notifId) => {
  try { await updateDoc(doc(fbDb, `notificaciones/${uid}/items/${notifId}`), {leida: true}); }
  catch(e) { console.error('marcarNotifLeida', e); }
};

// Marcar todas como leídas
const marcarTodasLeidas = async (uid, notifIds) => {
  try {
    const batch = writeBatch(fbDb);
    for (const id of notifIds) {
      batch.update(doc(fbDb, `notificaciones/${uid}/items/${id}`), {leida: true});
    }
    await batch.commit();
  } catch(e) { console.error('marcarTodasLeidas', e); }
};

// Auto-archivar notif > 30 días
const archivarViejas = async (uid, notifs) => {
  const limite = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const viejas = notifs.filter(n => {
    if (n.archivada) return false;
    const ms = n.fecha?.toMillis?.() || (typeof n.fecha === 'number' ? n.fecha : 0);
    return ms > 0 && ms < limite;
  });
  if (viejas.length === 0) return;
  try {
    const batch = writeBatch(fbDb);
    for (const n of viejas) {
      batch.update(doc(fbDb, `notificaciones/${uid}/items/${n.id}`), {archivada: true});
    }
    await batch.commit();
  } catch(e) { console.error('archivarViejas', e); }
};

// ── Helper KPIs por obra (reutilizable para Dashboard, Panel Ejecutivo y PDF) ──
// Devuelve métricas calculadas a partir de los datos de UNA obra.
// Datos vacíos (sin Firestore) producen ceros pero no rompe la función.
const calcularKPIsObra = (obra, subs=[], maquinaria=[], materiales=[], estimaciones=[]) => {
  const presupuesto = obra?.presupuesto || 0;
  const gastoGP = obra?.gastoGP || 0;
  // Gasto total = GP del Sheet + maquinaria propia
  const gt = gastoGP + maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  // Avance monetario ejecutado (∑ avance × importe subsección)
  const am = subs.reduce((t,s)=>t+((s.a||0)/100)*(s.imp||0), 0);
  // Almacén (materiales en sitio/tránsito)
  const alm = materiales.reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  // Monto ejecutado = avance + almacén
  const me = am + alm;
  // Avance físico ponderado %
  const af = presupuesto > 0
    ? subs.reduce((t,s)=>t+((s.a||0)/100)*((s.imp||0)/presupuesto)*100, 0)
    : 0;
  // Margen
  const diff = me - gt;
  const mpct = me > 0 ? (diff/me)*100 : 0;
  // Estimaciones
  const estPag    = estimaciones.filter(e=>e.estatus==="Pagada").reduce((t,e)=>t+(e.monto||0), 0);
  const estPorCob = estimaciones.filter(e=>["Facturada","Aprobada"].includes(e.estatus)).reduce((t,e)=>t+(e.monto||0), 0);
  const estProc   = estimaciones.filter(e=>e.estatus==="En proceso").reduce((t,e)=>t+(e.monto||0), 0);
  const estFact   = estimaciones.filter(e=>e.estatus==="Facturada").reduce((t,e)=>t+(e.monto||0), 0);
  const estTotal  = estimaciones.reduce((t,e)=>t+(e.monto||0), 0);
  // Brecha = % gasto vs % avance físico (riesgo #1 del semáforo)
  const pctGasto = presupuesto > 0 ? (gt/presupuesto)*100 : 0;
  const brecha = pctGasto - af;
  // Por estimar (obra ejecutada sin facturar al cliente)
  const porEstimar = Math.max(am - estTotal, 0);
  // ── ATRASO DE COBRO ──
  // Para cada estimación "Facturada", calcular días desde fechaFact y comparar contra diasPago del contrato
  const diasPago = obra?.diasPago || 30;
  const hoy = new Date();
  const atrasos = estimaciones
    .filter(e => e.estatus === "Facturada" && e.fechaFact)
    .map(e => {
      const dias = Math.floor((hoy - new Date(e.fechaFact))/(1000*60*60*24));
      return { ...e, diasTrans: dias, diasAtraso: Math.max(dias - diasPago, 0) };
    });
  const montoAtrasado = atrasos.filter(a=>a.diasAtraso>0).reduce((t,a)=>t+(a.monto||0), 0);
  const maxAtraso = atrasos.reduce((m,a)=>Math.max(m, a.diasAtraso), 0);
  return {
    presupuesto, gastoGP, gt, am, alm, me, af, diff, mpct,
    estPag, estPorCob, estProc, estFact, estTotal, porEstimar,
    pctGasto, brecha,
    diasPago, atrasos, montoAtrasado, maxAtraso,
  };
};

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
  "ofosadog@fosmon.com.mx":  { rol:"director_operaciones", nombre:"Oscar Fosado Galland" },
  "aoliva@fosmon.com.mx":    { rol:"gerente_construccion", nombre:"Alejandro Noe Oliva Somellera" },
  "pcastillo@fosmon.com.mx": { rol:"administrador_obra",   nombre:"Pablo Castillo Villalobos" },
  "lmayo@fosmon.com.mx":     { rol:"admin_sistema",        nombre:"Luis Mayo" },
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
  superintendente:     "Superintendente",
  residente:           "Residente",
  administrador_obra:  "Administrador de Obra",
  admin_sistema:       "Administrador de Sistema",
  cliente:             "Cliente",
};

// Permisos: can(rol, modulo, accion)
// acciones: 'ver' | 'editar'
// modulos: 'dash','captura','gastos','estimaciones','riesgo','personal_detalle','todas_obras'
// Equipo de obra (super/residente/admin_obra): mismos permisos por default.
// Puede afinarse por obra desde Planeación → Permisos (override).
const PERMISOS = {
  director_general:    { dash:"ver", captura:null,      gastos:"ver",    estimaciones:"ver",    riesgo:"ver",    todas_obras:true  },
  director_operaciones:{ dash:"ver", captura:"editar",  gastos:"editar", estimaciones:"editar", riesgo:"ver",    todas_obras:true  },
  gerente_construccion:{ dash:"ver", captura:"editar",  gastos:"ver",    estimaciones:"ver",    riesgo:"ver",    todas_obras:true  },
  superintendente:     { dash:"ver", captura:"editar",  gastos:"editar", estimaciones:"editar", riesgo:"editar", todas_obras:false },
  residente:           { dash:"ver", captura:"editar",  gastos:"editar", estimaciones:"editar", riesgo:"editar", todas_obras:false },
  administrador_obra:  { dash:"ver", captura:"editar",  gastos:"editar", estimaciones:"editar", riesgo:"editar", todas_obras:false },
  admin_sistema:       { dash:"ver", captura:null,      gastos:"ver",    estimaciones:"ver",    riesgo:"ver",    todas_obras:true  },
  cliente:             { dash:null,  captura:null,      gastos:null,     estimaciones:null,     riesgo:null,    todas_obras:false },
};

// Override de permisos por obra: { [rol]: { [modulo]: "ver"|"editar"|null } }
// Se setea al entrar a una obra desde Firestore (obras/{id}/config/permisos).
let _permisosObraOverride = null;
const setPermisosObraOverride = (override) => { _permisosObraOverride = override; };
const getPermisosObraOverride = () => _permisosObraOverride;

function can(rol, modulo, accion="ver") {
  // 1) Override por obra (si hay y tiene definido el rol/módulo)
  let v = null;
  if (_permisosObraOverride && _permisosObraOverride[rol] && _permisosObraOverride[rol][modulo] !== undefined) {
    v = _permisosObraOverride[rol][modulo];
  } else {
    // 2) Default global
    const p = PERMISOS[rol];
    if (!p) return false;
    v = p[modulo];
  }
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
  /* Ocultar flechas de inputs number (spinner) — se ven feas en inputs pequeños */
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button {
    -webkit-appearance:none; margin:0;
  }
  input[type=number] { -moz-appearance:textfield; appearance:textfield; }
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
// Catálogo de muestra eliminado — cada obra debe cargar su catálogo desde Presupuesto.
const CATALOGO = {};

// Nómina hardcodeada de muestra eliminada — se carga vacía por defecto.
// Cada obra debe cargar su propia nómina desde el módulo de captura semanal.
const NOMINA_S18 = [];

// Sin obras hardcodeadas. Todas las obras se crean desde GP Construct vía PantallaObras.
const _OBRAS_BASE = [];

function loadObras() {
  // No hay obras base. La carga real de obras vive en Firestore y se hidrata
  // desde el useEffect bulk en App al hacer login. Aquí solo devolvemos array vacío
  // para arrancar limpio.
  return [];
}

// Sin catálogo hardcodeado. Cada obra debe cargar su catálogo desde el módulo Presupuesto.
const SUBS_INIT = [];

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
      const emailId = email.replace(/@/g,'_').replace(/\./g,'_');
      // Buscar perfil en Firestore (para roles dinámicos)
      let perfil = await fsGet(`usuarios/${emailId}`);
      if (!perfil) {
        // Si no existe en Firestore: usar default hardcodeado y crear el documento
        // (necesario para que Cloud Functions puedan verificar el rol del usuario)
        perfil = ROLES_DEFAULT[email] || { rol:"administrador_obra", nombre:email };
        await fsSet(`usuarios/${emailId}`, {
          email,
          nombre: perfil.nombre,
          rol: perfil.rol,
          obras_asignadas: [],
          activo: true,
          uid: cred.user.uid,
          creadoEn: new Date().toISOString(),
          creadoPor: "auto-sync-from-login",
        });
      }
      if (perfil.activo === false) {
        setError("Tu usuario está desactivado. Contacta al administrador.");
        try { await signOut(fbAuth); } catch {}
        setLoading(false);
        return;
      }
      // Configura ctx de auditoría y registra login
      setAuditCtx({ correo: email, nombre: perfil.nombre, rol: perfil.rol, obraId: null, obraNombre: "" });
      fsAudit("login", { modulo: "sesion", entidad: email });
      onLogin({
        correo: email,
        nombre: perfil.nombre,
        rol: perfil.rol,
        uid: cred.user.uid,
        obras_asignadas: Array.isArray(perfil.obras_asignadas) ? perfil.obras_asignadas : [],
        bienvenidaVista: perfil.bienvenidaVista === true,
        emailId,
      });
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
        <EmblemaFOSMON size={48} dark={true}/>
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

// ── Parser CSV robusto (maneja comillas con comas dentro) ──
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

// Convierte "$1,234.56" o "-$1,234" o "1234" a número (devuelve NaN si no aplica)
function parseMonto(s) {
  if (!s) return NaN;
  const limpio = String(s).replace(/[$\s,()]/g, '');
  if (!limpio || limpio === '-') return NaN;
  const n = parseFloat(limpio);
  return isNaN(n) ? NaN : n;
}

// Parser de GP Construct v3 — robusto a estructura con AÑOS DESPLEGADOS
//
// El Sheet tiene jerarquía: Año → Mes → Semanas (cada uno con su Total).
// Cada año tiene sus propias semanas (14, 15...) que se REPITEN. Para el acumulado
// real SIEMPRE usamos "Total general"; las columnas individuales son para análisis temporal.
function parsearGPConstruct(csvText) {
  const lines = csvText.split('\n').map(parseCsvLine);
  const MESES = {
    'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06',
    'julio':'07','agosto':'08','septiembre':'09','octubre':'10','noviembre':'11','diciembre':'12'
  };
  const normalize = (s) => (s||'').toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,'').trim();

  const colMap = {};
  const maxScan = Math.min(lines.length, 12);

  // Identificar fila de años (texto "2024", "2025", "2026")
  let yearRow = -1;
  let yearCols = {};
  for (let i = 0; i < maxScan; i++) {
    const matches = lines[i].map((c, ci) => /^20\d{2}$/.test((c||'').trim()) ? ci : -1).filter(x => x >= 0);
    if (matches.length >= 1) {
      yearRow = i;
      matches.forEach(ci => { yearCols[lines[i][ci].trim()] = ci; });
      break;
    }
  }

  // Identificar fila de meses (con nombres de meses)
  let monthRow = -1;
  for (let i = 0; i < maxScan; i++) {
    const tieneMeses = lines[i].some(c => {
      const m = (c||'').toLowerCase();
      return /enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/.test(m);
    });
    if (tieneMeses) { monthRow = i; break; }
  }

  // Identificar fila de semanas (≥5 números cortos)
  let weekRow = -1;
  for (let i = 0; i < maxScan; i++) {
    const numCount = lines[i].filter(c => /^[1-5]?[0-9]$/.test((c||'').trim())).length;
    if (numCount >= 5) { weekRow = i; break; }
  }

  // Detectar Grand Total y Totales anuales en CUALQUIER fila de header
  for (let i = 0; i < maxScan; i++) {
    lines[i].forEach((cellRaw, ci) => {
      const c = (cellRaw || '').trim();
      if (!c) return;
      const n = normalize(c);
      // Grand Total / Total general
      if ((n === 'total general' || n === 'grand total' || /^grand\s*total$/i.test(c))
          && colMap.grand_total === undefined) {
        colMap.grand_total = ci;
      }
      // Total anual
      const matchTotalAño = c.match(/total\s*(20\d{2})|^(20\d{2})\s*total$/i);
      if (matchTotalAño) {
        const año = matchTotalAño[1] || matchTotalAño[2];
        const key = `total_year_${año}`;
        if (colMap[key] === undefined) colMap[key] = ci;
      }
      // Total mensual
      const matchTotalMes = c.match(/total\s+(?:\d+\s*[.\-]+\s*)?([a-záéíóú]+)/i);
      if (matchTotalMes) {
        const mesNombre = normalize(matchTotalMes[1]);
        if (MESES[mesNombre]) {
          const key = `total_month_2026_${MESES[mesNombre]}`;
          if (colMap[key] === undefined) colMap[key] = ci;
        }
      }
      if (c === '%' && colMap.pct === undefined) colMap.pct = ci;
    });
  }

  // Mapear semanas al año contextual (basado en posición de columna)
  const weekColsByYear = {};
  if (weekRow >= 0) {
    const orderedYears = Object.entries(yearCols).sort((a,b) => a[1] - b[1]);
    let añoActual = null;
    let cur = 0;
    for (let ci = 0; ci < lines[weekRow].length; ci++) {
      while (cur < orderedYears.length && ci >= orderedYears[cur][1]) {
        añoActual = orderedYears[cur][0];
        cur++;
      }
      const cell = (lines[weekRow][ci] || '').trim();
      if (/^[1-5]?[0-9]$/.test(cell) && añoActual) {
        const n = parseInt(cell);
        if (n >= 1 && n <= 53) {
          if (!weekColsByYear[añoActual]) weekColsByYear[añoActual] = {};
          weekColsByYear[añoActual][n] = ci;
        }
      }
    }
  }
  // Solo nos quedamos con las semanas del año más reciente para "semanas disponibles"
  const añoMasReciente = Object.keys(weekColsByYear).sort().pop() || '2026';
  const weekColsActual = weekColsByYear[añoMasReciente] || {};
  Object.entries(weekColsActual).forEach(([n, ci]) => {
    colMap[`week_${añoMasReciente}_${n}`] = ci;
  });

  // Años individuales (sin desplegar) si existen
  Object.entries(yearCols).forEach(([año, ci]) => {
    colMap[`year_${año}`] = ci;
  });

  const ultimoHeaderRow = Math.max(yearRow, monthRow, weekRow);
  const dataStart = ultimoHeaderRow >= 0 ? ultimoHeaderRow + 1 : 8;

  const obras = {};
  let curObra = null, curRubro = null;

  for (let i = dataStart; i < lines.length; i++) {
    const row = lines[i];
    const label = (row[1] || '').trim();
    if (!label) continue;
    if (/^(grand\s*total|total\s+general)$/i.test(label)) continue;
    if (/^total/i.test(label)) continue;
    if (/^\d\s+(EGRESOS|INGRESOS)/i.test(label)) continue;

    const extraerValores = () => {
      let grandTotal = parseMonto(row[colMap.grand_total]) || 0;
      grandTotal = Math.abs(grandTotal);

      const años = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('total_year_')).forEach(([k, ci]) => {
        const año = k.replace('total_year_', '');
        const v = parseMonto(row[ci]);
        if (!isNaN(v) && v !== 0) años[`Y${año}`] = Math.abs(v);
      });

      const meses = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('total_month_')).forEach(([k, ci]) => {
        const mesKey = k.replace('total_month_', '').replace('_', '-');
        const v = parseMonto(row[ci]);
        if (!isNaN(v) && v !== 0) meses[`M${mesKey}`] = Math.abs(v);
      });

      const semanas = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('week_')).forEach(([k, ci]) => {
        const partes = k.split('_');
        const v = parseMonto(row[ci]);
        if (!isNaN(v) && v !== 0) semanas[`S${partes[2]}`] = Math.abs(v);
      });

      const total2026 = años['Y2026'] || 0;
      return { semanas, meses, años, total2026, grandTotal };
    };

    if (/^\d{4}\s/.test(label)) {
      curObra = label;
      curRubro = null;
      if (!obras[curObra]) {
        const vals = extraerValores();
        obras[curObra] = {
          id: label.slice(0, 4), nombre: label,
          semanas: vals.semanas, meses: vals.meses, años: vals.años,
          total2026: vals.total2026, grandTotal: vals.grandTotal,
          rubros: {}, proveedores: [],
        };
      }
    } else if (/^\d{3}\s/.test(label) && curObra) {
      curRubro = label.slice(0, 3);
      if (!obras[curObra].rubros[curRubro]) {
        const vals = extraerValores();
        obras[curObra].rubros[curRubro] = {
          id: curRubro, nombre: label, nombreCorto: label.slice(4).trim(),
          semanas: vals.semanas, meses: vals.meses, años: vals.años,
          total2026: vals.total2026, grandTotal: vals.grandTotal,
          proveedores: [],
        };
      }
    } else if (curObra && curRubro && !/^\d/.test(label)) {
      const vals = extraerValores();
      const totalProv = vals.grandTotal > 0
        ? vals.grandTotal
        : Object.values(vals.años).reduce((t,v)=>t+v,0);
      if (totalProv === 0) continue;
      const prov = {
        nombre: label, rubroId: curRubro,
        rubroNombre: obras[curObra].rubros[curRubro].nombreCorto,
        semanas: vals.semanas, meses: vals.meses, años: vals.años,
        total2026: vals.total2026, grandTotal: vals.grandTotal,
        total: totalProv,
      };
      obras[curObra].rubros[curRubro].proveedores.push(prov);
      obras[curObra].proveedores.push(prov);
    }
  }

  const semanasDisponibles = Object.keys(colMap)
    .filter(k => k.startsWith('week_'))
    .map(k => `S${k.split('_')[2]}`)
    .sort((a,b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const ultimaSemana = semanasDisponibles[semanasDisponibles.length - 1] || '';

  const mesesDisponibles = Object.keys(colMap)
    .filter(k => k.startsWith('total_month_'))
    .map(k => `M${k.replace('total_month_', '').replace('_', '-')}`)
    .sort();
  const ultimoMes = mesesDisponibles[mesesDisponibles.length - 1] || '';

  return {
    obras, semanasDisponibles, ultimaSemana,
    mesesDisponibles, ultimoMes,
    totalObras: Object.keys(obras).length, colMap,
  };
}

// Hook para cargar datos de GP Construct
function useGPConstruct() {
  // gpData ahora es el RESUMEN (~50KB): obras con totales pero sin rubros ni proveedores.
  // Para análisis detallado de una obra (rubros + proveedores), cargarDetalleGP(obraId).
  const [gpData, setGpData] = useState(null);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState('');
  const [gpUltActualiz, setGpUltActualiz] = useState('');
  // Cache de detalles ya cargados: { '0114': {grandTotal, rubros, proveedores, ...} }
  const [gpDetalles, setGpDetalles] = useState({});

  const PARSER_VERSION = 3;

  // Compatibilidad: el documento global/gp_construct ahora tiene formato nuevo (sin data wrapper)
  // pero leemos también el formato viejo (con data wrapper) por si hay cache previo.
  const extraerResumen = (cached) => {
    if (!cached) return null;
    // Nuevo formato: campos en root
    if (cached.obras && cached.parserVersion) return cached;
    // Formato viejo: dentro de 'data'
    if (cached.data?.obras && cached.parserVersion) return {...cached.data, parserVersion: cached.parserVersion, ultimaActualizacion: cached.ultimaActualizacion};
    return null;
  };

  const cargarGP = useCallback(async (forzar = false) => {
    setGpLoading(true); setGpError('');
    let mensajeError = '';
    try {
      if (forzar) {
        try {
          const fn = httpsCallable(fbFn, 'refrescarGP');
          const res = await fn({});
          console.log('refrescarGP OK:', res.data);
          // Invalidar cache de detalles para forzar recarga
          setGpDetalles({});
        } catch (e) {
          const detalle = e.message || String(e);
          if (e.code === 'functions/not-found' || /not.*found/i.test(detalle)) {
            mensajeError = 'La Cloud Function "refrescarGP" no existe. Necesita deploy: firebase deploy --only functions';
          } else if (e.code === 'functions/unauthenticated') {
            mensajeError = 'Sesión expirada. Cierra sesión y vuelve a entrar.';
          } else {
            mensajeError = `Error al refrescar (${e.code||'unknown'}): ${detalle}`;
          }
          console.error('refrescarGP falló:', e);
        }
      }
      // Leer SOLO el resumen (ligero) del Firestore
      const cached = await fsGet('global/gp_construct');
      const resumen = extraerResumen(cached);
      if (resumen && resumen.parserVersion === PARSER_VERSION) {
        setGpData(resumen);
        setGpUltActualiz(new Date(resumen.ultimaActualizacion).toLocaleString('es-MX'));
        if (mensajeError) setGpError(mensajeError);
      } else if (resumen) {
        setGpError(mensajeError || 'Caché del Sheet es de una versión vieja. Click Refrescar.');
      } else {
        setGpError(mensajeError || 'El Sheet no se ha sincronizado nunca. Click Refrescar (la primera tarda ~30s).');
      }
    } catch (e) {
      setGpError(`Error al leer caché de GP: ${e.message}`);
    }
    setGpLoading(false);
  }, []);

  // Carga el detalle completo (rubros + proveedores) de UNA obra específica
  // Se invoca solo cuando se necesita (ej: al entrar al tab Gastos)
  const cargarDetalleObra = useCallback(async (obraIdGP) => {
    if (!obraIdGP) return null;
    if (gpDetalles[obraIdGP]) return gpDetalles[obraIdGP]; // ya está en cache
    try {
      const det = await fsGet(`global/gp_detalle/obras/${obraIdGP}`);
      if (det && det.parserVersion === PARSER_VERSION) {
        setGpDetalles(prev => ({...prev, [obraIdGP]: det}));
        return det;
      }
    } catch(e) {
      console.warn('cargarDetalleObra error:', e);
    }
    return null;
  }, [gpDetalles]);

  useEffect(() => { cargarGP(); }, []);

  return { gpData, gpLoading, gpError, gpUltActualiz, cargarGP, cargarDetalleObra, gpDetalles };
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

function ModalNuevaObra({onSave,onClose,gpData,onRefreshGP,gpLoading,gpError}){
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
      // ID = código GP de 4 dígitos exacto (sin prefijo "GP") para que matchee con el Sheet
      id: obra.id,
      gpId: obra.id,
      nombre: obra.nombre,
      gastoGP: obra.gastoGP,
    }));
    setPaso("completar");
  }

  // Usar datos del Sheet si están disponibles, sino el catálogo estático
  // gastoGP usa Grand Total (acumulado real) - no la semana actual
  const gpCatalogo = gpData
    ? Object.entries(gpData.obras).map(([key, val]) => {
        // Grand Total real, fallback a años+total2026, o suma de meses si nada existe
        const totalReal = val.grandTotal > 0
          ? val.grandTotal
          : Object.values(val.años||{}).reduce((t,v)=>t+v, 0)
            + (val.total2026 || Object.values(val.meses||{}).reduce((t,v)=>t+v, 0));
        return {
          id: val.id || key.slice(0,4),
          nombre: key.slice(5).trim(),
          gastoGP: totalReal,
          semanas: val.semanas,
          rubros: val.rubros,
          grandTotal: val.grandTotal,
          total2026: val.total2026,
        };
      }).sort((a,b) => a.id.localeCompare(b.id))
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
          {/* Aviso + botón refresh si el Sheet no está cargado */}
          {!gpData?.obras && (
            <div style={{background:`${C.yellow}15`,border:`0.5px solid ${C.yellow}55`,borderRadius:6,
              padding:"9px 12px",marginBottom:8}}>
              <div style={{fontSize:10,color:C.yellowDk,marginBottom:6}}>
                ⚠ El Sheet de GP no está cargado. Estás viendo un catálogo de referencia desactualizado.
              </div>
              {gpError && (
                <div style={{fontSize:9,color:C.redDk,marginBottom:6,
                  background:`${C.red}10`,padding:"5px 8px",borderRadius:4}}>
                  {gpError}
                </div>
              )}
              {onRefreshGP && (
                <button onClick={()=>onRefreshGP(true)} disabled={gpLoading}
                  style={{background:C.caliza,border:"none",borderRadius:6,padding:"5px 12px",
                    fontSize:10,fontWeight:600,color:C.bg,cursor:gpLoading?"not-allowed":"pointer",
                    opacity:gpLoading?0.5:1}}>
                  {gpLoading?"Refrescando…":"Refrescar Sheet ahora"}
                </button>
              )}
            </div>
          )}
          {gpData?.obras && (
            <div style={{fontSize:9,color:C.textMut,marginBottom:8}}>
              Sheet sincronizado: {Object.keys(gpData.obras).length} obras
            </div>
          )}
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

// ════════════════════════════════════════════════════════════════════════════
// CENTRO DE NOTIFICACIONES (campana en header con dropdown)
// ════════════════════════════════════════════════════════════════════════════
function CentroNotificaciones({usuario, notificaciones, onNavTab, onSelectObra}){
  const[abierto,setAbierto]=useState(false);
  const dropdownRef = useRef(null);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!abierto) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [abierto]);

  // Filtrar las no archivadas y ordenar por fecha desc
  const activas = (notificaciones||[])
    .filter(n => !n.archivada)
    .sort((a,b) => (b.fecha?.toMillis?.()||0) - (a.fecha?.toMillis?.()||0));
  const noLeidas = activas.filter(n => !n.leida);
  const noLeidasCount = noLeidas.length;

  const COLOR_CAT = {
    actividad: C.blue,
    financiero: C.purple,
    riesgo: C.red,
    plazo: C.yellow,
    gestion: C.green,
    resumen: C.caliza,
  };
  const ICON_CAT = {
    actividad: '●',
    financiero: '$',
    riesgo: '!',
    plazo: '◷',
    gestion: '+',
    resumen: '≡',
  };

  const formatearFecha = (n) => {
    const ms = n.fecha?.toMillis?.() || 0;
    if (!ms) return '';
    const diffMin = Math.floor((Date.now() - ms) / 60000);
    if (diffMin < 1) return 'Ahora';
    if (diffMin < 60) return `Hace ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Hace ${diffD}d`;
    return new Date(ms).toLocaleDateString('es-MX', {day:'numeric', month:'short'});
  };

  const onClickNotif = async (n) => {
    if (!n.leida) await marcarNotifLeida(usuario.uid, n.id);
    setAbierto(false);
    if (n.link?.obraId && onSelectObra) onSelectObra(n.link.obraId);
    if (n.link?.tab && onNavTab) onNavTab(n.link.tab, n.link.subTab);
  };

  const marcarTodas = async () => {
    if (noLeidas.length === 0) return;
    await marcarTodasLeidas(usuario.uid, noLeidas.map(n=>n.id));
  };

  return <div style={{position:'relative'}} ref={dropdownRef}>
    {/* Campana */}
    <button onClick={()=>setAbierto(!abierto)} title="Notificaciones"
      style={{background:abierto?C.caliza:'none',border:`0.5px solid ${abierto?C.caliza:C.border}`,
        borderRadius:6, padding:'4px 8px', fontSize:14, cursor:'pointer',
        color:abierto?C.bg:C.textSec, position:'relative', minWidth:32}}>
      {String.fromCharCode(0x2691)/* flag-like icon */}
      {noLeidasCount > 0 && (
        <span style={{position:'absolute', top:-4, right:-4, background:C.red, color:'#fff',
          borderRadius:99, padding:'1px 5px', fontSize:8, fontWeight:700, minWidth:14, textAlign:'center'}}>
          {noLeidasCount > 9 ? '9+' : noLeidasCount}
        </span>
      )}
    </button>

    {/* Dropdown */}
    {abierto && (
      <div style={{position:'absolute', right:0, top:'calc(100% + 6px)', width:360, maxWidth:'95vw',
        maxHeight:480, background:'#fff', border:`0.5px solid ${C.border}`, borderRadius:10,
        boxShadow:'0 8px 24px rgba(0,0,0,0.15)', zIndex:300, display:'flex', flexDirection:'column'}}>
        {/* Header */}
        <div style={{padding:'10px 12px', borderBottom:`0.5px solid ${C.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div>
            <div style={{fontSize:12, fontWeight:700, color:C.caliza}}>Notificaciones</div>
            <div style={{fontSize:9, color:C.textMut}}>
              {noLeidasCount > 0 ? `${noLeidasCount} sin leer` : 'Todo al día'}
            </div>
          </div>
          {noLeidasCount > 0 && (
            <button onClick={marcarTodas}
              style={{background:'none', border:'none', fontSize:10, color:C.blueDk,
                cursor:'pointer', fontWeight:600}}>
              Marcar todas
            </button>
          )}
        </div>

        {/* Lista */}
        <div style={{overflow:'auto', flex:1}}>
          {activas.length === 0 && (
            <div style={{padding:30, textAlign:'center', color:C.textMut, fontSize:11}}>
              Sin notificaciones por el momento.
            </div>
          )}
          {activas.map(n => {
            const col = COLOR_CAT[n.categoria] || C.textMut;
            const icon = ICON_CAT[n.categoria] || '·';
            return <div key={n.id} onClick={()=>onClickNotif(n)}
              style={{padding:'10px 12px', borderBottom:`0.5px solid ${C.border}`,
                cursor:'pointer', background:n.leida?'transparent':`${col}08`,
                borderLeft:`3px solid ${n.leida?'transparent':col}`,
                transition:'background .12s'}}
              onMouseEnter={e=>e.currentTarget.style.background=C.bg}
              onMouseLeave={e=>e.currentTarget.style.background=n.leida?'transparent':`${col}08`}>
              <div style={{display:'flex', alignItems:'flex-start', gap:8}}>
                <div style={{width:20, height:20, borderRadius:'50%', background:`${col}22`,
                  color:col, fontSize:11, fontWeight:700, display:'flex',
                  alignItems:'center', justifyContent:'center', flexShrink:0}}>{icon}</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', justifyContent:'space-between', gap:6, alignItems:'baseline'}}>
                    <div style={{fontSize:11, fontWeight:n.leida?500:700, color:C.caliza,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {n.titulo}
                    </div>
                    <div style={{fontSize:9, color:C.textMut, flexShrink:0}}>{formatearFecha(n)}</div>
                  </div>
                  {n.mensaje && (
                    <div style={{fontSize:10, color:C.textSec, marginTop:2, lineHeight:1.4}}>
                      {n.mensaje}
                    </div>
                  )}
                </div>
                {!n.leida && (
                  <div style={{width:6, height:6, borderRadius:'50%', background:col, flexShrink:0, marginTop:5}}/>
                )}
              </div>
            </div>;
          })}
        </div>
      </div>
    )}
  </div>;
}

// ── GESTIÓN DE USUARIOS (solo director_general y admin_sistema) ────────────
// Llama a Cloud Functions para crear/editar/eliminar usuarios en Firebase Auth + Firestore.
function GestionUsuarios({usuario, obras, onClose}){
  const[usuarios,setUsuarios]=useState([]);
  const[cargando,setCargando]=useState(true);
  const[error,setError]=useState("");
  const[modalNuevo,setModalNuevo]=useState(false);
  const[modalEditar,setModalEditar]=useState(null);
  const[modalEliminar,setModalEliminar]=useState(null);
  const[modalPassword,setModalPassword]=useState(null);
  const[busy,setBusy]=useState(false);

  const recargar = async () => {
    setCargando(true); setError("");
    const r = await callFn("listarUsuarios");
    if(r.ok) setUsuarios(r.data.usuarios||[]);
    else setError(r.error||"Error al cargar usuarios");
    setCargando(false);
  };

  useEffect(()=>{ recargar(); },[]);

  const rolColor = {
    director_general: C.purple,
    director_operaciones: C.blue,
    gerente_construccion: C.green,
    administrador_obra: C.yellow,
    admin_sistema: C.caliza,
    cliente: C.textMut,
  };

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {error && <div style={{background:`${C.red}15`,border:`0.5px solid ${C.red}55`,borderRadius:8,
      padding:"9px 12px",fontSize:11,color:C.redDk}}>⚠ {error}</div>}

    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <Tit>Gestión de usuarios</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>Crear, editar y eliminar accesos a CAMPO</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <SecBtn onClick={recargar}>Recargar</SecBtn>
          <button onClick={()=>setModalNuevo(true)} style={{background:C.caliza,border:"none",borderRadius:6,
            padding:"6px 14px",fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer"}}>
            + Nuevo usuario
          </button>
        </div>
      </div>

      {cargando ? <div style={{padding:20,textAlign:"center",fontSize:11,color:C.textMut}}>Cargando…</div>
      : usuarios.length===0 ? <div style={{padding:20,textAlign:"center",fontSize:11,color:C.textMut}}>
          Sin usuarios registrados. Crea el primero con "+ Nuevo usuario".
        </div>
      : <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {/* Header */}
          <div style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr 1fr auto",gap:8,
            padding:"6px 10px",fontSize:9,color:C.textMut,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>
            <div>Usuario</div><div>Email</div><div>Rol</div><div>Estado</div><div></div>
          </div>
          {usuarios.map(u=>(
            <div key={u.id} style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr 1fr auto",gap:8,
              padding:"9px 10px",background:C.bg,borderRadius:8,alignItems:"center",
              opacity:u.activo?1:0.55}}>
              <div style={{fontSize:11,fontWeight:600,color:C.caliza}}>{u.nombre}</div>
              <div style={{fontSize:10,color:C.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
              <div><Bdg color={rolColor[u.rol]||C.textMut} small>{ROL_LABEL[u.rol]||u.rol}</Bdg></div>
              <div>
                <Bdg color={u.activo?C.green:C.red} small>{u.activo?"Activo":"Inactivo"}</Bdg>
              </div>
              <div style={{display:"flex",gap:4}}>
                <button onClick={()=>setModalEditar(u)} title="Editar"
                  style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:4,
                    padding:"3px 8px",fontSize:9,color:C.textSec,cursor:"pointer"}}>Editar</button>
                <button onClick={()=>setModalPassword(u)} title="Resetear contraseña"
                  style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:4,
                    padding:"3px 8px",fontSize:9,color:C.textSec,cursor:"pointer"}}>Pass</button>
                {u.email !== usuario.correo && (
                  <button onClick={()=>setModalEliminar(u)} title="Eliminar"
                    style={{background:"none",border:`0.5px solid ${C.red}44`,borderRadius:4,
                      padding:"3px 8px",fontSize:9,color:C.red,cursor:"pointer"}}>×</button>
                )}
              </div>
            </div>
          ))}
        </div>}
    </Card>

    {/* MODAL NUEVO */}
    {modalNuevo && <ModalUsuario titulo="Nuevo usuario" obras={obras}
      onCancel={()=>setModalNuevo(false)} pedirPassword={true}
      onConfirm={async (form)=>{
        setBusy(true);
        const r = await callFn("crearUsuario", form);
        setBusy(false);
        if(!r.ok){ alert("Error: "+r.error); return; }
        setModalNuevo(false);
        recargar();
        // Notif al usuario nuevo y a directivos
        await notifAEmail(form.email, {
          categoria: 'gestion', tipo: 'bienvenida',
          titulo: `Bienvenido a CAMPO`,
          mensaje: `Tu cuenta fue creada con rol ${ROL_LABEL[form.rol]||form.rol}. Cambia tu contraseña al ingresar.`,
          creadaPor: usuario?.correo || 'sistema',
        });
        await notifARoles(['director_general'], {
          categoria: 'gestion', tipo: 'usuario_creado',
          titulo: `Nuevo usuario en CAMPO`,
          mensaje: `${form.nombre} (${form.email}) · ${ROL_LABEL[form.rol]||form.rol}`,
          creadaPor: usuario?.correo || 'sistema',
        });
      }} busy={busy}/>}

    {/* MODAL EDITAR */}
    {modalEditar && <ModalUsuario titulo="Editar usuario" obras={obras} usuario={modalEditar}
      onCancel={()=>setModalEditar(null)}
      onConfirm={async (form)=>{
        setBusy(true);
        const cambios = {nombre:form.nombre, rol:form.rol, obras_asignadas:form.obras_asignadas, activo:form.activo};
        const r = await callFn("actualizarUsuario", {email:modalEditar.email, cambios});
        setBusy(false);
        if(!r.ok){ alert("Error: "+r.error); return; }
        // Detectar cambios y notif
        const obrasAntes = modalEditar.obras_asignadas || [];
        const obrasNuevas = form.obras_asignadas || [];
        const obrasAgregadas = obrasNuevas.filter(o => !obrasAntes.includes(o));
        if (modalEditar.rol !== form.rol) {
          await notifAEmail(modalEditar.email, {
            categoria: 'gestion', tipo: 'cambio_rol',
            titulo: `Tu rol cambió`,
            mensaje: `Ahora eres ${ROL_LABEL[form.rol]||form.rol}`,
            creadaPor: usuario?.correo || 'sistema',
          });
        }
        if (obrasAgregadas.length > 0) {
          const nombresObras = obrasAgregadas.map(id => {
            const o = obras.find(x => x.id === id);
            return o ? o.nombre : id;
          }).join(', ');
          await notifAEmail(modalEditar.email, {
            categoria: 'gestion', tipo: 'obra_asignada',
            titulo: `Te asignaron a nueva(s) obra(s)`,
            mensaje: `${nombresObras}`,
            creadaPor: usuario?.correo || 'sistema',
          });
        }
        if (modalEditar.activo !== false && form.activo === false) {
          await notifAEmail(modalEditar.email, {
            categoria: 'gestion', tipo: 'desactivado',
            titulo: `Tu cuenta fue desactivada`,
            mensaje: `Contacta al administrador si necesitas reactivarla.`,
            creadaPor: usuario?.correo || 'sistema',
          });
        }
        setModalEditar(null);
        recargar();
      }} busy={busy}/>}

    {/* MODAL RESETEAR PASSWORD */}
    {modalPassword && <ModalPassword usuario={modalPassword}
      onCancel={()=>setModalPassword(null)}
      onConfirm={async (nuevaPassword)=>{
        setBusy(true);
        const r = await callFn("cambiarPassword", {email:modalPassword.email, nuevaPassword});
        setBusy(false);
        if(!r.ok){ alert("Error: "+r.error); return; }
        setModalPassword(null);
        alert(`Contraseña actualizada para ${modalPassword.email}`);
      }} busy={busy}/>}

    {/* MODAL ELIMINAR */}
    {modalEliminar && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:210,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"white",borderRadius:12,padding:20,width:"100%",maxWidth:400}}>
        <div style={{fontSize:13,fontWeight:600,color:C.redDk,marginBottom:8}}>Eliminar usuario permanentemente</div>
        <div style={{fontSize:12,color:C.textSec,marginBottom:14}}>
          ¿Eliminar a <b>{modalEliminar.nombre}</b> ({modalEliminar.email})?<br/>
          Se borrará de Firebase Auth y de la base de datos. No se puede deshacer.
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <SecBtn onClick={()=>setModalEliminar(null)}>Cancelar</SecBtn>
          <button disabled={busy} onClick={async()=>{
            setBusy(true);
            const r = await callFn("eliminarUsuario", {email:modalEliminar.email});
            setBusy(false);
            if(!r.ok){ alert("Error: "+r.error); return; }
            setModalEliminar(null);
            recargar();
          }} style={{background:C.red,border:"none",borderRadius:6,padding:"7px 14px",
            fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer",opacity:busy?0.5:1}}>
            {busy?"Eliminando…":"Sí, eliminar"}
          </button>
        </div>
      </div>
    </div>}
  </div>;
}

// ── MODAL FORMULARIO USUARIO (nuevo o editar) ──
function ModalUsuario({titulo, usuario, obras, onCancel, onConfirm, busy, pedirPassword}){
  const[form,setForm]=useState({
    email: usuario?.email||"",
    nombre: usuario?.nombre||"",
    rol: usuario?.rol||"administrador_obra",
    obras_asignadas: usuario?.obras_asignadas||[],
    activo: usuario?.activo!==false,
    password: "",
  });

  const ROLES = [
    ["director_general","Director General"],
    ["director_operaciones","Director de Operaciones"],
    ["gerente_construccion","Gerente de Construcción"],
    ["administrador_obra","Administrador de Obra"],
    ["admin_sistema","Administrador de Sistema"],
    ["cliente","Cliente"],
  ];

  const toggleObra = (id) => setForm(f=>{
    const a = new Set(f.obras_asignadas);
    if(a.has(id)) a.delete(id); else a.add(id);
    return {...f, obras_asignadas:[...a]};
  });

  const submit = () => {
    if(!form.email || !form.nombre || !form.rol) { alert("Email, nombre y rol son requeridos"); return; }
    if(pedirPassword && (!form.password || form.password.length<6)) { alert("Contraseña mínimo 6 caracteres"); return; }
    onConfirm(form);
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:210,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"white",borderRadius:12,padding:20,width:"100%",maxWidth:480,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{fontSize:14,fontWeight:700,color:C.caliza,marginBottom:14}}>{titulo}</div>

      <div style={{marginBottom:10}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase"}}>Correo</div>
        <Inp type="email" value={form.email} disabled={!!usuario}
          placeholder="usuario@fosmon.com.mx"
          onChange={e=>setForm({...form, email:e.target.value})}/>
      </div>

      <div style={{marginBottom:10}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase"}}>Nombre completo</div>
        <Inp type="text" value={form.nombre}
          onChange={e=>setForm({...form, nombre:e.target.value})}/>
      </div>

      {pedirPassword && <div style={{marginBottom:10}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase"}}>Contraseña inicial</div>
        <Inp type="text" value={form.password} placeholder="mínimo 6 caracteres"
          onChange={e=>setForm({...form, password:e.target.value})}/>
        <div style={{fontSize:9,color:C.textMut,marginTop:3}}>El usuario debería cambiarla al entrar.</div>
      </div>}

      <div style={{marginBottom:10}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase"}}>Rol</div>
        <Sel value={form.rol} onChange={e=>setForm({...form, rol:e.target.value})}>
          {ROLES.map(([id,lbl])=><option key={id} value={id}>{lbl}</option>)}
        </Sel>
      </div>

      {/* Asignación de obras — útil para clientes y admin de obra */}
      {(form.rol==="cliente" || form.rol==="administrador_obra") && obras && obras.length>0 && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:9,color:C.textMut,marginBottom:5,textTransform:"uppercase"}}>
            Obras asignadas {form.rol==="cliente"?"(qué obras puede ver el cliente)":"(qué obras administra)"}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:140,overflow:"auto",
            border:`0.5px solid ${C.border}`,borderRadius:6,padding:8}}>
            {obras.map(o=>(
              <label key={o.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,cursor:"pointer"}}>
                <input type="checkbox" checked={form.obras_asignadas.includes(o.id)}
                  onChange={()=>toggleObra(o.id)}/>
                <span style={{color:C.textPri}}>{o.id} · {o.nombre}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {usuario && <div style={{marginBottom:10}}>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:11,cursor:"pointer"}}>
          <input type="checkbox" checked={form.activo}
            onChange={e=>setForm({...form, activo:e.target.checked})}/>
          <span style={{color:C.textPri}}>Usuario activo (puede iniciar sesión)</span>
        </label>
      </div>}

      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
        <SecBtn onClick={onCancel}>Cancelar</SecBtn>
        <button disabled={busy} onClick={submit} style={{background:C.caliza,border:"none",borderRadius:6,
          padding:"7px 14px",fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer",opacity:busy?0.5:1}}>
          {busy?"Guardando…":(usuario?"Guardar cambios":"Crear usuario")}
        </button>
      </div>
    </div>
  </div>;
}

// ── MODAL RESETEAR CONTRASEÑA ──
function ModalPassword({usuario, onCancel, onConfirm, busy}){
  const[pass,setPass]=useState("");
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:210,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"white",borderRadius:12,padding:20,width:"100%",maxWidth:380}}>
      <div style={{fontSize:13,fontWeight:600,color:C.caliza,marginBottom:6}}>Resetear contraseña</div>
      <div style={{fontSize:11,color:C.textSec,marginBottom:14}}>
        Usuario: <b>{usuario.nombre}</b> ({usuario.email})
      </div>
      <div style={{marginBottom:10}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase"}}>Nueva contraseña</div>
        <Inp type="text" value={pass} placeholder="mínimo 6 caracteres" onChange={e=>setPass(e.target.value)}/>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
        <SecBtn onClick={onCancel}>Cancelar</SecBtn>
        <button disabled={busy||pass.length<6} onClick={()=>onConfirm(pass)}
          style={{background:C.caliza,border:"none",borderRadius:6,padding:"7px 14px",
            fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer",opacity:(busy||pass.length<6)?0.5:1}}>
          {busy?"Guardando…":"Guardar"}
        </button>
      </div>
    </div>
  </div>;
}

// ── PANEL EJECUTIVO MULTI-OBRA ─────────────────────────────────────────────
// Vista consolidada para Director General / Director Operaciones / Gerente.
// Muestra: KPIs portafolio, cobranza agrupada por cliente (acordeón) y top obras de atención.
function PanelEjecutivo({obras, datosPorObra, onSelectObra}){
  const[expandido,setExpandido]=useState(true);
  const[clienteAbierto,setClienteAbierto]=useState(null);

  const activas = obras.filter(o=>o.estado!=="archivada");
  // Calcular KPIs para cada obra activa
  const obrasConKPIs = activas.map(o => {
    const d = datosPorObra[o.id] || {subs:[],maquinaria:[],materiales:[],estimaciones:[]};
    return { obra: o, kpis: calcularKPIsObra(o, d.subs, d.maquinaria, d.materiales, d.estimaciones) };
  });

  // Agrupar por cliente
  const porCliente = {};
  obrasConKPIs.forEach(({obra,kpis}) => {
    const c = obra.cliente || "Sin cliente";
    if(!porCliente[c]) porCliente[c] = { cliente:c, obras:[], totales:{presupuesto:0,estTotal:0,estPorCob:0,estPag:0,estProc:0,montoAtrasado:0,maxAtraso:0} };
    porCliente[c].obras.push({obra,kpis});
    porCliente[c].totales.presupuesto += kpis.presupuesto;
    porCliente[c].totales.estTotal += kpis.estTotal;
    porCliente[c].totales.estPorCob += kpis.estPorCob;
    porCliente[c].totales.estPag += kpis.estPag;
    porCliente[c].totales.estProc += kpis.estProc;
    porCliente[c].totales.montoAtrasado += kpis.montoAtrasado;
    porCliente[c].totales.maxAtraso = Math.max(porCliente[c].totales.maxAtraso, kpis.maxAtraso);
  });
  const clientes = Object.values(porCliente).sort((a,b)=>b.totales.estPorCob - a.totales.estPorCob);

  // KPIs portafolio (consolidados)
  const port = obrasConKPIs.reduce((t,{kpis}) => ({
    presupuesto: t.presupuesto + kpis.presupuesto,
    estTotal:    t.estTotal    + kpis.estTotal,
    estPorCob:   t.estPorCob   + kpis.estPorCob,
    estPag:      t.estPag      + kpis.estPag,
    estProc:     t.estProc     + kpis.estProc,
    montoAtrasado: t.montoAtrasado + kpis.montoAtrasado,
  }), {presupuesto:0,estTotal:0,estPorCob:0,estPag:0,estProc:0,montoAtrasado:0});

  // Top atención (por brecha avance-gasto descendente, solo brecha > 0)
  const topAtencion = [...obrasConKPIs]
    .filter(({kpis})=>kpis.brecha>5 || kpis.maxAtraso>0)
    .sort((a,b)=>{
      // Prioridad: monto atrasado descendente, luego brecha descendente
      if(b.kpis.montoAtrasado !== a.kpis.montoAtrasado) return b.kpis.montoAtrasado - a.kpis.montoAtrasado;
      return b.kpis.brecha - a.kpis.brecha;
    })
    .slice(0,3);

  if(activas.length<2) return null;  // No muestra el panel si hay 0 o 1 obras

  const kpiBox = (label, value, color, sub) => (
    <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${color}`}}>
      <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:3}}>{label}</div>
      <div style={{fontSize:13,fontWeight:700,color:color}}>{value}</div>
      {sub && <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{sub}</div>}
    </div>
  );

  return <Card accent={C.caliza} style={{marginBottom:10}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:expandido?12:0,cursor:"pointer"}}
         onClick={()=>setExpandido(!expandido)}>
      <div>
        <Tit>Panel ejecutivo — {activas.length} obras activas</Tit>
        <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>Cobranza consolidada y obras que requieren atención</div>
      </div>
      <span style={{fontSize:14,color:C.textMut}}>{expandido?"▾":"▸"}</span>
    </div>

    {expandido && <>
      {/* KPIs portafolio */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:14}}>
        {kpiBox("Presupuesto total", MXN(port.presupuesto), C.caliza, `${activas.length} obras`)}
        {kpiBox("Total estimado", MXN(port.estTotal), C.blue, port.presupuesto>0?`${NUM(port.estTotal/port.presupuesto*100,1)}% del contrato`:"")}
        {kpiBox("Por cobrar", MXN(port.estPorCob), port.montoAtrasado>0?C.red:C.purpleDk, "facturado + aprobado")}
        {kpiBox("Cobrado", MXN(port.estPag), C.greenDk, "pagado y liquidado")}
        {kpiBox("En proceso", MXN(port.estProc), C.yellowDk, "estimaciones en elaboración")}
        {kpiBox("Atrasado", MXN(port.montoAtrasado), port.montoAtrasado>0?C.red:C.green, port.montoAtrasado>0?"fuera del plazo":"todo dentro de plazo")}
      </div>

      {/* COBRANZA POR CLIENTE */}
      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:600,color:C.textPri,letterSpacing:"0.02em"}}>COBRANZA POR CLIENTE</div>
          <div style={{fontSize:9,color:C.textMut}}>Ordenado por monto por cobrar</div>
        </div>
        {clientes.length===0 && <div style={{fontSize:11,color:C.textMut,padding:"8px 0"}}>Sin clientes con estimaciones</div>}
        {clientes.map(({cliente,obras:obrasCli,totales})=>{
          const abierto = clienteAbierto === cliente;
          const tieneAtraso = totales.montoAtrasado > 0;
          return <div key={cliente} style={{background:C.bg,borderRadius:8,marginBottom:6,
            borderLeft:`3px solid ${tieneAtraso?C.red:C.blueDk}`,overflow:"hidden"}}>
            <div onClick={()=>setClienteAbierto(abierto?null:cliente)}
                 style={{padding:"10px 13px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.caliza}}>{cliente}</span>
                  <Bdg color={C.textMut} small>{obrasCli.length} {obrasCli.length===1?"obra":"obras"}</Bdg>
                  {tieneAtraso && <Bdg color={C.red} small>Atraso {totales.maxAtraso}d</Bdg>}
                </div>
                <div style={{fontSize:9,color:C.textMut}}>
                  Estimado: {MXN(totales.estTotal)} · Pagado: {MXN(totales.estPag)}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>POR COBRAR</div>
                <div style={{fontSize:14,fontWeight:700,color:tieneAtraso?C.red:C.purpleDk}}>{MXN(totales.estPorCob)}</div>
              </div>
              <span style={{fontSize:12,color:C.textMut,flexShrink:0}}>{abierto?"▾":"▸"}</span>
            </div>
            {/* Detalle expandido: obras del cliente */}
            {abierto && <div style={{borderTop:`0.5px solid ${C.border}`,background:C.surface,padding:"8px 13px"}}>
              {obrasCli.map(({obra,kpis})=>(
                <div key={obra.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"6px 0",borderBottom:`0.5px solid ${C.border}`,gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:C.caliza}}>{obra.id} · {obra.nombre}</div>
                    <div style={{fontSize:9,color:C.textMut,marginTop:1}}>
                      Avance: {NUM(kpis.af,1)}% · Estimado: {MXN(kpis.estTotal)} · Por cobrar: {MXN(kpis.estPorCob)}
                      {kpis.maxAtraso>0 && <span style={{color:C.red,marginLeft:6}}>· Atraso {kpis.maxAtraso}d</span>}
                    </div>
                  </div>
                  <button onClick={()=>onSelectObra(obra.id)}
                    style={{background:C.caliza,border:"none",borderRadius:6,padding:"4px 10px",
                      fontSize:10,fontWeight:600,color:C.bg,cursor:"pointer",flexShrink:0}}>
                    Entrar
                  </button>
                </div>
              ))}
            </div>}
          </div>;
        })}
      </div>

      {/* OBRAS QUE REQUIEREN ATENCIÓN */}
      {topAtencion.length>0 && <div>
        <div style={{fontSize:11,fontWeight:600,color:C.textPri,letterSpacing:"0.02em",marginBottom:8}}>
          OBRAS QUE REQUIEREN ATENCIÓN
        </div>
        {topAtencion.map(({obra,kpis},i)=>{
          const motivos = [];
          if(kpis.montoAtrasado>0) motivos.push(`${MXN(kpis.montoAtrasado)} atrasados (${kpis.maxAtraso}d)`);
          if(kpis.brecha>15) motivos.push(`Brecha gasto/avance +${NUM(kpis.brecha,1)}pp`);
          else if(kpis.brecha>5) motivos.push(`Brecha gasto/avance +${NUM(kpis.brecha,1)}pp`);
          return <div key={obra.id} onClick={()=>onSelectObra(obra.id)}
            style={{background:C.bg,borderRadius:8,padding:"9px 12px",marginBottom:6,cursor:"pointer",
              borderLeft:`3px solid ${kpis.montoAtrasado>0?C.red:kpis.brecha>15?C.red:C.yellow}`,
              display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:10,color:C.textMut,fontWeight:700}}>{i+1}.</span>
                <span style={{fontSize:11,fontWeight:700,color:C.caliza}}>{obra.id} · {obra.nombre}</span>
              </div>
              <div style={{fontSize:9,color:C.textSec,marginTop:3}}>{motivos.join(" · ")}</div>
            </div>
            <span style={{fontSize:11,color:C.textMut}}>›</span>
          </div>;
        })}
      </div>}
    </>}
  </Card>;
}

function PantallaObras({onSelect,usuario,obras,setObras,gpData,gpLoading,gpUltActualiz,onRefreshGP,datosPorObra={}}){
  // Si obras es undefined o no es array, normalizar a array vacío para evitar crashes
  if(!obras||!Array.isArray(obras)) obras = [];
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

  // Filtrado de obras visibles:
  // - Roles con todas_obras=true: ven todas
  // - Roles con todas_obras=false (cliente, administrador_obra): solo las que están en usuario.obras_asignadas
  const asignadas = Array.isArray(usuario.obras_asignadas) ? usuario.obras_asignadas : [];
  const todasObras = PERMISOS[usuario.rol]?.todas_obras
    ? obras
    : (asignadas.length > 0
        ? obras.filter(o => asignadas.includes(o.id))
        : []);
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
    const id = confirmarEliminar.id;
    const snapshotPrev = confirmarEliminar;
    await Promise.all([
      fsDel(`obras/${id}`),
      fsDel(`obras/${id}/config/info`),
      fsDel(`obras/${id}/config/parametros`),
      fsDel(`obras/${id}/config/estimaciones`),
      fsDel(`obras/${id}/config/catalogo`),
      fsDel(`obras/${id}/avance/subs`),
      fsDel(`obras/${id}/avance/maquinaria`),
      fsDel(`obras/${id}/avance/materiales`),
      fsDel(`obras/${id}/avance/historial`),
      fsDel(`obras/${id}/nomina/historial`),
      fsDel(`obras/${id}/contrato/plazos`),
      fsDel(`obras/${id}/contrato/documentos`),
      fsDel(`obras/${id}/subcontratos/lista`),
    ]);
    // Auditar (1 sola entrada por operación de borrado de obra)
    fsAudit("borrar", { modulo: "obra", entidad: snapshotPrev.nombre || id,
      obraId: id, obraNombre: snapshotPrev.contrato || snapshotPrev.nombre || "",
      antes: snapshotPrev, path: `obras/${id}` });
    setObras(oo=>oo.filter(o=>o.id!==id));
    setConfirmarEliminar(null); setIdConfirm(""); setElimStep(1);
  };

  const agregarObra=async(form)=>{
    const nueva={...form,presupuesto:parseFloat(form.presupuesto)||0};
    setObras(oo=>[...oo,nueva]);
    // Guardar en Firestore: top-level + sub-doc info
    await fsSet(`obras/${nueva.id}`, nueva);
    await fsSet(`obras/${nueva.id}/config/info`, nueva);
    fsAudit("crear", { modulo: "obra", entidad: nueva.nombre,
      obraId: nueva.id, obraNombre: nueva.contrato || nueva.nombre || "",
      despues: nueva, path: `obras/${nueva.id}` });
    setModalNueva(false);
    // Notif a directivos sobre la nueva obra
    notifARoles(['director_general','director_operaciones','admin_sistema'], {
      categoria: 'gestion', tipo: 'obra_nueva',
      titulo: `Nueva obra · ${nueva.nombre}`,
      mensaje: `${nueva.cliente || 'Sin cliente'} · Presupuesto: ${MXN(nueva.presupuesto)} · ID ${nueva.id}`,
      link: { obraId: nueva.id, tab: 'dash' },
      creadaPor: usuario?.correo || 'sistema',
    });
  };

  const listaActual=ordenar(verHistorial?archivadas:activas);

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {modalNueva&&<ModalNuevaObra onSave={agregarObra} onClose={()=>setModalNueva(false)} gpData={gpData} onRefreshGP={onRefreshGP} gpLoading={gpLoading}/>}

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
          Hola, {(usuario.nombre||'').split(' ').find(p=>p.length>2&&!p.endsWith('.'))||''}!
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

    {/* Panel ejecutivo multi-obra — solo roles directivos y si hay ≥2 obras activas */}
    {!verHistorial && ["director_general","director_operaciones","gerente_construccion"].includes(usuario.rol) && (
      <PanelEjecutivo obras={todasObras} datosPorObra={datosPorObra} onSelectObra={onSelect}/>
    )}

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
        {/* Datos visibles según rol: cliente solo ve presupuesto e info pública, no costos */}
        {usuario.rol === "cliente" ? (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:9}}>
            {[["Presupuesto",MXN(o.presupuesto),C.textPri],
              ["Inicio",o.inicio||"—",C.textSec],
              ["Fin programado",o.finAmpliado||o.fin||"—",C.textSec]].map(([l,v,c])=>
              <div key={l}><div style={{fontSize:9,color:C.textMut,marginBottom:1}}>{l}</div>
                <div style={{fontSize:12,fontWeight:500,color:c}}>{v}</div></div>)}
          </div>
        ) : (
          <>
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
          </>
        )}
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
// ════════════════════════════════════════════════════════════════════════════
// BANNER DE RIESGOS — Dashboard
// ════════════════════════════════════════════════════════════════════════════
function BannerRiesgos({riesgos, onNavTab, compacto=false}){
  const [expandido, setExpandido] = useState(false);
  const criticos = riesgos.filter(r => r.severidad === 'critico');
  const altos = riesgos.filter(r => r.severidad === 'alto');
  const medios = riesgos.filter(r => r.severidad === 'medio');
  const bajos = riesgos.filter(r => r.severidad === 'bajo');
  const totalGrave = criticos.length + altos.length;
  const accent = criticos.length > 0 ? C.red : altos.length > 0 ? C.red : medios.length > 0 ? C.yellow : C.textMut;
  const mostrar = expandido ? riesgos : riesgos.filter(r => r.severidad === 'critico' || r.severidad === 'alto');

  return <Card accent={accent}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:700,color:C.caliza,letterSpacing:"0.04em"}}>RIESGOS DETECTADOS</span>
        {criticos.length > 0 && <Bdg color={C.red} small>{criticos.length} crítico{criticos.length>1?'s':''}</Bdg>}
        {altos.length > 0 && <Bdg color={C.red} small>{altos.length} alto{altos.length>1?'s':''}</Bdg>}
        {medios.length > 0 && <Bdg color={C.yellow} small>{medios.length} medio{medios.length>1?'s':''}</Bdg>}
        {bajos.length > 0 && expandido && <Bdg color={C.textMut} small>{bajos.length} bajo{bajos.length>1?'s':''}</Bdg>}
      </div>
      <button onClick={()=>setExpandido(!expandido)} style={{background:"none",border:"none",
        fontSize:10,color:C.blueDk,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}>
        {expandido ? "Ver solo críticos ▴" : `Ver todos (${riesgos.length}) ▾`}
      </button>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {mostrar.map((r,i)=>{
        const sevDef = SEVERIDADES[r.severidad] || SEVERIDADES.medio;
        return <div key={r.id+'_'+i} onClick={()=>onNavTab && onNavTab(r.tab, r.subTab)}
          style={{background:C.bg,borderRadius:6,padding:"8px 11px",fontSize:10,
            borderLeft:`3px solid ${sevDef.color}`,cursor:onNavTab?"pointer":"default",
            display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,
            transition:"background .12s"}}
          onMouseEnter={e=>{if(onNavTab)e.currentTarget.style.background=C.surface;}}
          onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <span style={{fontSize:8,fontWeight:700,color:sevDef.color,textTransform:"uppercase",letterSpacing:"0.04em"}}>{sevDef.label}</span>
              <span style={{fontSize:10,fontWeight:700,color:C.textPri}}>{r.titulo}</span>
            </div>
            <div style={{fontSize:9,color:C.textSec}}>{r.detalle}</div>
            {r.extra && <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{r.extra}</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:13,fontWeight:700,color:sevDef.color,lineHeight:1}}>{r.valor}</div>
            {onNavTab && <div style={{fontSize:9,color:sevDef.color,marginTop:3,fontWeight:600}}>Revisar ›</div>}
          </div>
        </div>;
      })}
    </div>
  </Card>;
}

// ── TENDENCIAS MENSUALES ──────────────────────────────────────────────────
// Muestra evolución mes a mes de: Avance físico %, Gasto acumulado,
// Estimaciones cobradas y Margen. Por default últimos 6 meses.
// Datos consolidados desde múltiples fuentes:
// - Avance: historialAvance (semanas con avancePonderado)
// - Gasto: gpData.semanas + otros gastos manuales + maquinaria
// - Estimaciones: estimaciones con su periodo/fecha cobro
// - Margen: ejecutado - gastado por mes
function TendenciasMensuales({obra, historialAvance, gpData, estimaciones, datosObraGP, otrosGastos}) {
  const [rango, setRango] = useState(6); // últimos N meses
  const [metricaActiva, setMetricaActiva] = useState('avance');

  // ── Generar lista de últimos N meses (YYYY-MM)
  const meses = (() => {
    const hoy = new Date();
    const out = [];
    for (let i = rango - 1; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      out.push({
        ym,
        label: d.toLocaleDateString('es-MX', {month:'short', year:'2-digit'}),
        date: d,
      });
    }
    return out;
  })();

  // ── Avance % por mes: tomar el último snapshot del mes
  const avancePorMes = {};
  (historialAvance || []).forEach(snap => {
    const f = new Date(snap.fechaCaptura);
    const ym = `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}`;
    if (!avancePorMes[ym] || new Date(snap.fechaCaptura) > new Date(avancePorMes[ym].fechaCaptura)) {
      avancePorMes[ym] = snap;
    }
  });

  // ── Gasto acumulado por mes: sumar GP + otros gastos + maquinaria hasta ese mes
  const gastoPorMes = {};
  let acumGP = 0;
  meses.forEach(m => {
    // GP del Sheet (por semana, agrupar por mes)
    if (datosObraGP?.semanas) {
      Object.keys(datosObraGP.semanas).forEach(semKey => {
        // semKey formato típico Wxx-yy, no tiene fecha clara. Usamos heurística:
        // si tenemos meses, dividimos uniformemente. Mejor: usar datosObraGP.meses si existe
      });
    }
    // Usar meses del GP si vienen agrupados
    if (datosObraGP?.meses) {
      Object.entries(datosObraGP.meses).forEach(([mesKey, val]) => {
        // mesKey puede ser tipo "ene", "feb"... mapear
      });
    }
  });
  // Estrategia más simple: si tenemos histórico de gpData.meses con keys YYYY-MM, usar directo
  // Si no, distribuir el gasto total entre los meses (no ideal)
  meses.forEach(m => {
    let g = 0;
    // 1) GP por mes (formato YYYY-MM o "MMM-YY")
    if (datosObraGP?.mesesPorAño) {
      Object.values(datosObraGP.mesesPorAño).forEach(añoMeses => {
        Object.entries(añoMeses).forEach(([k,v]) => {
          // intentar match con ym
          if (k === m.ym || k.includes(m.label.split(' ')[0])) g += v;
        });
      });
    }
    // 2) Otros gastos manuales con fecha
    (otrosGastos || []).forEach(og => {
      if (!og.fecha) return;
      const f = new Date(og.fecha);
      const fYm = `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}`;
      if (fYm === m.ym) g += parseFloat(og.importe) || 0;
    });
    acumGP += g;
    gastoPorMes[m.ym] = acumGP;
  });

  // ── Estimaciones cobradas (acumulado) por mes
  const estPorMes = {};
  let acumEst = 0;
  meses.forEach(m => {
    let cobrado = 0;
    (estimaciones || []).forEach(e => {
      const fecha = e.fechaCobro || e.fecha || e.periodo;
      if (!fecha) return;
      const f = new Date(fecha);
      if (isNaN(f.getTime())) return;
      const fYm = `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}`;
      const estNorm = (e.estatus||'').toLowerCase();
      const esCobrada = estNorm === 'pagada' || estNorm === 'cobrada';
      if (fYm === m.ym && esCobrada) cobrado += e.monto || 0;
    });
    acumEst += cobrado;
    estPorMes[m.ym] = acumEst;
  });

  // ── Datos por métrica
  const datosMetricas = {
    avance: {
      label: 'Avance físico',
      color: C.greenDk,
      formato: (v) => `${(v||0).toFixed(1)}%`,
      max: 100,
      valores: meses.map(m => avancePorMes[m.ym]?.avancePonderado || 0),
    },
    gasto: {
      label: 'Gasto acumulado',
      color: C.redDk,
      formato: (v) => MXN(v),
      max: null, // auto
      valores: meses.map(m => gastoPorMes[m.ym] || 0),
    },
    estimaciones: {
      label: 'Estimaciones cobradas',
      color: C.blueDk,
      formato: (v) => MXN(v),
      max: null,
      valores: meses.map(m => estPorMes[m.ym] || 0),
    },
    margen: {
      label: 'Margen',
      color: C.purple,
      formato: (v) => MXN(v),
      max: null,
      // Margen = ejecutado (avance % × presupuesto) - gasto acumulado
      valores: meses.map(m => {
        const avPct = avancePorMes[m.ym]?.avancePonderado || 0;
        const ejecutado = (avPct / 100) * (obra.presupuesto || 0);
        const gastado = gastoPorMes[m.ym] || 0;
        return ejecutado - gastado;
      }),
    },
  };

  const metricaSel = datosMetricas[metricaActiva];
  const valores = metricaSel.valores;
  const maxValor = metricaSel.max !== null ? metricaSel.max : Math.max(...valores.map(Math.abs), 1);
  const minValor = Math.min(...valores, 0);
  const rangoY = maxValor - minValor || 1;

  // SVG sparkline + barras
  const W = 600, H = 140, PL = 50, PR = 12, PT = 14, PB = 26;
  const cw = W - PL - PR, ch = H - PT - PB;
  const xPos = (i) => PL + (cw / Math.max(meses.length - 1, 1)) * i;
  const yPos = (v) => PT + ch - ((v - minValor) / rangoY) * ch;

  return <Card>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
      <Tit>Tendencias mes a mes</Tit>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <select value={rango} onChange={e=>setRango(Number(e.target.value))}
          style={{fontSize:10,padding:"3px 6px",border:`1px solid ${C.border}`,borderRadius:4,color:C.textSec}}>
          <option value={3}>Últimos 3 meses</option>
          <option value={6}>Últimos 6 meses</option>
          <option value={12}>Últimos 12 meses</option>
        </select>
      </div>
    </div>

    {/* Selector de métrica como tabs pequeños */}
    <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
      {Object.entries(datosMetricas).map(([key, m]) => (
        <button key={key} onClick={()=>setMetricaActiva(key)}
          style={{flex:"1 1 auto",minWidth:90,padding:"6px 10px",fontSize:10,borderRadius:6,
            background: metricaActiva===key ? m.color : "transparent",
            border: `1px solid ${metricaActiva===key ? m.color : C.border}`,
            color: metricaActiva===key ? "#fff" : C.textSec,
            fontWeight: metricaActiva===key ? 600 : 400, cursor:"pointer", whiteSpace:"nowrap"}}>
          {m.label}
        </button>
      ))}
    </div>

    {/* Gráfica SVG */}
    <div style={{overflowX:"auto",width:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,minWidth:400}}>
        {/* Eje Y: 3 líneas guía */}
        {[0, 0.5, 1].map(p => (
          <line key={p} x1={PL} y1={PT + ch * p} x2={PL + cw} y2={PT + ch * p}
            stroke={C.border} strokeWidth={0.5} strokeDasharray={p===1?'0':'3,3'}/>
        ))}
        {/* Labels eje Y */}
        {[0, 0.5, 1].map(p => {
          const v = maxValor - rangoY * p;
          return <text key={p} x={PL - 6} y={PT + ch * p + 3}
            textAnchor="end" fontSize="9" fill={C.textMut}>
            {metricaSel.formato(v)}
          </text>;
        })}
        {/* Barras */}
        {meses.map((m, i) => {
          const v = valores[i];
          if (v <= 0 && minValor >= 0) return null;
          const xC = xPos(i);
          const bw = Math.min(cw / meses.length * 0.6, 40);
          const yTop = yPos(Math.max(v, 0));
          const yBase = yPos(0);
          const bh = Math.abs(yBase - yTop);
          return <rect key={m.ym}
            x={xC - bw/2} y={Math.min(yTop, yBase)}
            width={bw} height={bh || 1}
            fill={v >= 0 ? metricaSel.color : C.red}
            opacity={0.85} rx={2}/>;
        })}
        {/* Línea de tendencia */}
        <polyline
          fill="none" stroke={metricaSel.color} strokeWidth={2}
          points={meses.map((m, i) => `${xPos(i)},${yPos(valores[i])}`).join(' ')}/>
        {/* Puntos + valores */}
        {meses.map((m, i) => (
          <g key={m.ym}>
            <circle cx={xPos(i)} cy={yPos(valores[i])} r={3} fill={metricaSel.color}/>
            <text x={xPos(i)} y={yPos(valores[i]) - 8}
              textAnchor="middle" fontSize="9" fill={C.textPri} fontWeight="600">
              {valores[i] !== 0 ? metricaSel.formato(valores[i]) : ''}
            </text>
          </g>
        ))}
        {/* Eje X: labels de meses */}
        {meses.map((m, i) => (
          <text key={m.ym} x={xPos(i)} y={H - 8}
            textAnchor="middle" fontSize="10" fill={C.textSec}>
            {m.label}
          </text>
        ))}
      </svg>
    </div>

    {/* Resumen del período */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
      marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`,fontSize:10,color:C.textMut}}>
      <span>Inicio del período: {metricaSel.formato(valores[0])}</span>
      <span style={{fontWeight:600,color:metricaSel.color}}>
        Actual: {metricaSel.formato(valores[valores.length-1])}
      </span>
    </div>
  </Card>;
}

function Dashboard({obra,subs,maquinaria,materiales,estimaciones,subcontratos=[],historialAvance=[],gpData,otrosGastos=[],datosObraGP,onNavTab}){
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

  // ── ALERTAS desde la biblioteca de riesgos ──
  const pctGasto = obra.presupuesto > 0 ? gt/obra.presupuesto*100 : 0;
  const brecha = pctGasto - af;
  // KPIs consolidados que el motor de detección usa
  const kpisCtx = {gt, am, alm, me, af, diff, mpct, pctGasto, brecha};
  const riesgos = detectarRiesgos({
    obra, subs, maquinaria, materiales, estimaciones, subcontratos, historialAvance, gpData, kpis: kpisCtx
  });
  // Para el banner principal, solo mostramos críticos+altos (los medios y bajos van al panel completo)
  const riesgosTop = riesgos.filter(r => r.severidad === 'critico' || r.severidad === 'alto');
  const riesgosMed = riesgos.filter(r => r.severidad === 'medio');
  const totalRiesgos = riesgos.length;

  // ── Wrapper para hacer secciones clickeables ──
  // Acepta tabId principal y opcionalmente subTabId (para navegar a Operación > Avance, etc.)
  const clickableCard = (tabId, subTabId, extraStyle={}) => onNavTab && tabId ? {
    cursor:"pointer", transition:"transform .12s, box-shadow .12s", ...extraStyle,
    onMouseEnter: e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.08)";},
    onMouseLeave: e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";},
    onClick: ()=>onNavTab(tabId, subTabId)
  } : {};

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {/* BLOQUE 1: KPIs PRINCIPALES (clickables) */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
      <div {...clickableCard("operacion","avance")}>
        <Kpi label="Avance físico"   value={`${NUM(af,1)}%`} sub="ver avance ›"   color={semA(af)}/>
      </div>
      <div {...clickableCard("operacion","estimaciones")}>
        <Kpi label="Monto ejecutado" value={MXN(me)}         sub="vs estimaciones ›" color={C.blue} size={12}/>
      </div>
      <div {...clickableCard("gastos")}>
        <Kpi label="Gasto total"     value={MXN(gt)}         sub="ver gastos GP ›"   color={C.red}  size={12}/>
      </div>
      <div {...clickableCard("operacion","nomina")}>
        <Kpi label="Personal campo"  value={dir+ind}         sub={`${dir}D · ${ind}I · ver nómina ›`} color={C.green}/>
      </div>
    </div>

    {/* BLOQUE 1.5: TENDENCIAS MENSUALES */}
    <TendenciasMensuales
      obra={obra}
      historialAvance={historialAvance}
      gpData={gpData}
      estimaciones={estimaciones}
      datosObraGP={null}
      otrosGastos={otrosGastos}/>

    {/* BLOQUE 2: RIESGOS DETECTADOS (biblioteca con motor automático) */}
    {totalRiesgos > 0 && (
      <BannerRiesgos riesgos={riesgos} onNavTab={onNavTab}/>
    )}
    <Card accent={mc} {...clickableCard("operacion","estimaciones")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div><Tit>Margen bruto de obra {onNavTab && <span style={{fontSize:9,color:C.textMut,fontWeight:400}}>· ver detalle ›</span>}</Tit>
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
    <Card {...clickableCard("operacion","estimaciones")}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <Tit>Estimaciones {onNavTab && <span style={{fontSize:9,color:C.textMut,fontWeight:400}}>· ver detalle ›</span>}</Tit>
        <span style={{fontSize:9,color:C.textMut}}>{estimaciones.length} est. · Amort {obra.pctAnticipo}% · FG {obra.pctFondoGar}%</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(108px,1fr))",gap:8}}>
        <Kpi label="Pagado"        value={MXN(estPag)}    sub="cobrado y liquidado"    color={C.greenDk}  size={12}/>
        <Kpi label="Por cobrar"    value={MXN(estPorCob)} sub="facturado + aprobado"   color={C.purpleDk} size={12}/>
        <Kpi label="En proceso"    value={MXN(estProc)}   sub="en elaboración"          color={C.yellowDk} size={12}/>
        <Kpi label="Total estimado"value={MXN(estTotal)}  sub={`${(estTotal/obra.presupuesto*100).toFixed(1)}% del contrato`} color={C.blueDk} size={12}/>
      </div>
    </Card>
    {/* ── SUBCONTRATOS (resumen en Dashboard) ── */}
    {subcontratos.length > 0 && (
      <Card {...clickableCard("operacion","subcontratos")}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <Tit>Subcontratos {onNavTab && <span style={{fontSize:9,color:C.textMut,fontWeight:400}}>· ver módulo ›</span>}</Tit>
          <span style={{fontSize:9,color:C.textMut}}>
            {subcontratos.length} subcontrato{subcontratos.length===1?"":"s"} ·
            Valor total: {MXN(subcontratos.reduce((t,s)=>t+(s.monto||0),0))}
          </span>
        </div>
        {/* Header */}
        <div style={{display:"grid",gridTemplateColumns:"2fr 1.3fr 1fr 1fr",gap:8,
          padding:"4px 10px",fontSize:8,color:C.textMut,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>
          <div>Subcontrato</div><div style={{textAlign:"right"}}>Valor</div>
          <div style={{textAlign:"right"}}>Av. físico</div><div style={{textAlign:"right"}}>Av. financiero</div>
        </div>
        {subcontratos.slice(0,5).map(s => {
          const totalCat = s.conceptos?.reduce((t,c)=>t+(c.importe||0),0) || 0;
          const ejec = s.conceptos?.reduce((t,c)=>t+((c.avance||0)/100)*(c.importe||0),0) || 0;
          const pctFis = totalCat>0 ? ejec/totalCat*100 : 0;
          const pagado = s.pagos?.filter(p=>p.estatus==="pagado").reduce((t,p)=>t+(p.monto||0),0) || 0;
          const pctFin = s.monto>0 ? pagado/s.monto*100 : 0;
          const desfase = Math.abs(pctFis - pctFin);
          const colFis = pctFis>=100?C.green:pctFis>0?C.blue:C.textMut;
          const colFin = pctFin>=100?C.green:pctFin>0?C.purpleDk:C.textMut;
          return <div key={s.id} style={{display:"grid",gridTemplateColumns:"2fr 1.3fr 1fr 1fr",gap:8,
            padding:"9px 10px",background:C.bg,borderRadius:8,marginBottom:5,alignItems:"center",
            borderLeft:`3px solid ${desfase>20?C.yellow:C.border}`}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:C.caliza,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.nombre}</div>
              <div style={{fontSize:9,color:C.textMut,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.proveedor||"Sin proveedor"}</div>
            </div>
            <div style={{textAlign:"right",fontSize:11,fontWeight:600,color:C.textPri}}>{MXN(s.monto||0)}</div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,fontWeight:700,color:colFis}}>{NUM(pctFis,1)}%</div>
              <div style={{fontSize:8,color:C.textMut,marginTop:1}}>{MXN(ejec)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,fontWeight:700,color:colFin}}>{NUM(pctFin,1)}%</div>
              <div style={{fontSize:8,color:C.textMut,marginTop:1}}>{MXN(pagado)}</div>
            </div>
          </div>;
        })}
        {subcontratos.length > 5 && (
          <div style={{textAlign:"center",fontSize:10,color:C.textMut,marginTop:6}}>
            + {subcontratos.length - 5} subcontrato(s) más
          </div>
        )}
      </Card>
    )}

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

    <Card {...clickableCard("operacion","nomina")}>
      <Tit>Personal en campo — Semana 18 {onNavTab && <span style={{fontSize:9,color:C.textMut,fontWeight:400}}>· ver n\u00f3mina ›</span>}</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        <Kpi label="Total"     value={dir+ind} sub="trabajadores"  color={C.caliza}/>
        <Kpi label="Directo"   value={dir}     sub="mano de obra"  color={C.blue}/>
        <Kpi label="Indirecto" value={ind}     sub="administración"color={C.purple}/>
      </div>
    </Card>
    {lbFoto&&<Lightbox url={lbFoto} onClose={()=>setLbFoto(null)}/>}
    <Card {...clickableCard("operacion","avance")}>
      <Tit>Top subsecciones — avance y evidencia {onNavTab && <span style={{fontSize:9,color:C.textMut,fontWeight:400}}>· ver avance ›</span>}</Tit>
      {top4.map((s,i)=>{
        const fotos=(CATALOGO[s.sec]?.conceptos||[]).flatMap(c=>c.fotos||[]);
        const mostrar=fotos.slice(0,2);
        return <div key={s.id || `${s.sec}-${i}`} style={{marginBottom:12}}>
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
function GuardarAvanceBtn({obra, subs, maquinaria, materiales, onSaved, usuario, onHistorialNuevo}) {
  const[estado,setEstado]=useState("idle"); // idle | saving | saved | error
  async function guardar(tipoSnapshot = "intermedio") {
    setEstado("saving");
    try {
      // Guardar avance + datos completos de cada subsección incluyendo fotos
      // (las fotos se guardan en s.fotos[s.sec] = [...])
      const avanceData = {
        data: subs.map((s, idx)=>({
          id: s.id || `${s.sec || 'C'}__${idx}`,
          sec: s.sec, sub: s.sub || '', imp: s.imp || 0,
          n: s.n || 1, a: s.a || 0, fotos: s.fotos || {},
          cat: s.cat || null, catDesc: s.catDesc || null,
          ruta: s.ruta || [],
        })),
        fecha: new Date().toISOString()
      };
      await fsSetA(`obras/${obra.id}/avance/subs`, avanceData,
        { modulo:"avance_fisico", entidad:`captura ${tipoSnapshot}`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre,
          meta:{ tipo: tipoSnapshot, nSubs: subs.length, avancePromedio: subs.reduce((s,x)=>s+(x.a||0),0)/(subs.length||1) } });
      await fsSetA(`obras/${obra.id}/avance/maquinaria`,
        { data: maquinaria, fecha: new Date().toISOString() },
        { modulo:"maquinaria", entidad:`${maquinaria.length} equipos`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
      await fsSetA(`obras/${obra.id}/avance/materiales`,
        { data: materiales, fecha: new Date().toISOString() },
        { modulo:"almacen", entidad:`${materiales.length} materiales`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
      // Crear snapshot del avance para histórico semanal
      const snap = await crearSnapshotAvance(obra.id, subs, usuario?.correo, tipoSnapshot);
      if (snap && onHistorialNuevo) onHistorialNuevo(snap);
      // Si es oficial, también notif
      if (tipoSnapshot === "oficial" && snap) {
        await notifARoles(['director_general','director_operaciones','gerente_construccion','admin_sistema'], {
          categoria: 'actividad', tipo: 'cierre_semana',
          titulo: `Cierre semanal S${snap.semana} · ${obra.nombre || obra.id}`,
          mensaje: `Avance: ${snap.avancePonderado.toFixed(1)}% · ${usuario?.nombre || usuario?.correo} cerró el reporte`,
          link: { tab: 'operacion', subTab: 'avance', obraId: obra.id },
          creadaPor: usuario?.correo || 'sistema',
        });
      }
      setEstado("saved");
      if(onSaved) onSaved();
      setTimeout(()=>setEstado("idle"), 3000);
    } catch(e) {
      console.error(e);
      setEstado("error");
      setTimeout(()=>setEstado("idle"), 3000);
    }
  }
  const labels_map = {idle:"Guardar registro", saving:"Guardando...", saved:"Guardado", error:"Error al guardar"};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:6}}>
      <button onClick={()=>guardar("intermedio")} disabled={estado==="saving"}
        style={{background:estado==="idle"?C.blueDk:estado==="saved"?C.greenDk:estado==="error"?C.redDk:C.border,
          border:"none",borderRadius:8,padding:"10px 0",color:"white",
          fontSize:12,fontWeight:500,width:"100%",letterSpacing:"0.02em",
          cursor:estado==="saving"?"not-allowed":"pointer",transition:"all .3s"}}>
        {labels_map[estado]}
      </button>
      {/* Botón "Cerrar semana" — confirma con doble click */}
      <button onClick={() => {
          if (window.confirm(
            "Cerrar la semana:\n\n" +
            "- Esta guardará el avance actual como reporte semanal.\n" +
            "- Se notificará a los directivos.\n" +
            "- No podrás sobreescribir esta semana con guardados normales.\n\n" +
            "¿Confirmas el cierre semanal?")) {
            guardar("oficial");
          }
        }}
        disabled={estado==="saving"}
        style={{background:"transparent",border:`0.5px solid ${C.caliza}`,borderRadius:8,
          padding:"8px 0",color:C.caliza,fontSize:11,fontWeight:600,width:"100%",
          cursor:estado==="saving"?"not-allowed":"pointer"}}>
        Cerrar semana
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MINI-DASHBOARD DE AVANCE (con histórico semanal)
// ════════════════════════════════════════════════════════════════════════════
// KPIs: avance actual, esta semana (delta), velocidad promedio últimas 4 sem,
// proyección de fin a ritmo actual, desviación vs plazo.
// Detectores: partidas más calientes, estancadas (≥2 sem sin movimiento),
// retroceso, a ritmo crítico.
// Gráfica: línea acumulada vs ideal lineal.
function MiniDashAvance({obra, subs, historialAvance=[]}){
  // Avance actual ponderado
  const totalImp = subs.reduce((t,s)=>t+(s.imp||0), 0);
  const avanceActual = totalImp > 0
    ? subs.reduce((t,s)=>t+((s.a||0)/100)*((s.imp||0)/totalImp)*100, 0)
    : 0;

  // Snapshots oficiales ordenados (los intermedios solo para auditoría)
  const oficiales = (historialAvance||[])
    .filter(s => s.tipo === 'oficial')
    .sort((a,b) => (a.año-b.año)||(a.semana-b.semana));

  const ultimoOf = oficiales[oficiales.length-1] || null;
  const penultimoOf = oficiales[oficiales.length-2] || null;
  const deltaSemana = ultimoOf && penultimoOf ? ultimoOf.avancePonderado - penultimoOf.avancePonderado : 0;

  // Velocidad promedio últimas 4 semanas oficiales (pp/semana)
  const ult4 = oficiales.slice(-4);
  let velocidadProm = 0;
  if (ult4.length >= 2) {
    const totalDelta = ult4[ult4.length-1].avancePonderado - ult4[0].avancePonderado;
    const totalSems = ult4.length - 1;
    velocidadProm = totalSems > 0 ? totalDelta/totalSems : 0;
  }

  // Proyección de fin a ritmo actual (semanas hasta 100%)
  const pendientes = Math.max(100 - avanceActual, 0);
  const semsParaFin = velocidadProm > 0 ? Math.ceil(pendientes/velocidadProm) : null;
  const fechaProyFin = semsParaFin ? new Date(Date.now() + semsParaFin*7*86400000) : null;
  // Desviación vs plazo contratado
  const finContrato = obra.finAmpliado || obra.fin;
  let desvDias = null;
  if (fechaProyFin && finContrato) {
    desvDias = Math.round((fechaProyFin - new Date(finContrato))/86400000);
  }

  // ── DETECTORES ──
  // Mapear snapshots oficiales por sección para ver evolución de cada partida
  const ultimoMap = ultimoOf ? Object.fromEntries((ultimoOf.subs||[]).map(s=>[s.sec, s.a])) : {};
  const penMap = penultimoOf ? Object.fromEntries((penultimoOf.subs||[]).map(s=>[s.sec, s.a])) : {};
  const hace3Of = oficiales[oficiales.length-3] || null;
  const hace3Map = hace3Of ? Object.fromEntries((hace3Of.subs||[]).map(s=>[s.sec, s.a])) : {};

  // Top 5 partidas con mayor delta esta semana
  const calientes = subs.map(s => ({
    ...s,
    delta: ultimoOf ? (s.a||0) - (penMap[s.sec] ?? s.a ?? 0) : 0,
  }))
  .filter(s => s.delta > 0)
  .sort((a,b)=>b.delta-a.delta).slice(0,5);

  // Estancadas: ≥2 semanas sin movimiento (último vs hace 2 sem)
  const estancadas = oficiales.length >= 2
    ? subs.filter(s => {
        const ant = penMap[s.sec];
        if (ant === undefined) return false;
        return (s.a||0) > 0 && (s.a||0) < 100 && (s.a||0) === ant;
      }).slice(0,5)
    : [];

  // Retroceso: bajó de avance vs semana anterior
  const retroceso = subs.map(s => ({
    ...s,
    delta: ultimoOf ? (s.a||0) - (penMap[s.sec] ?? s.a ?? 0) : 0,
  })).filter(s => s.delta < -1).sort((a,b)=>a.delta-b.delta).slice(0,5);

  // Sin iniciar después de plazos
  const sinIniciar = subs.filter(s => (s.a||0) === 0).slice(0,5);

  // ── GRÁFICA: Curva S — avance acumulado real vs programado ──
  // Por cada snapshot oficial calculamos qué % deberíamos tener en esa fecha (lineal del 0 al 100% sobre el plazo)
  const inicio = obra.inicio ? new Date(obra.inicio) : null;
  const fin = finContrato ? new Date(finContrato) : null;
  const plazoTotalDias = (inicio && fin) ? (fin - inicio) / 86400000 : null;
  const programadoEnFecha = (fechaISO) => {
    if (!plazoTotalDias || plazoTotalDias <= 0) return null;
    const trans = (new Date(fechaISO) - inicio) / 86400000;
    return Math.min(Math.max((trans / plazoTotalDias) * 100, 0), 100);
  };
  const puntos = oficiales.length > 0
    ? oficiales.map(s => ({
        x: `S${s.semana}`,
        real: s.avancePonderado,
        programado: programadoEnFecha(s.fechaCierre || s.fechaCaptura),
        sem: s.semana, año: s.año,
      }))
    : [];
  // % ideal a fecha actual
  let idealActual = null;
  if (inicio && fin) {
    const total = (fin - inicio) / 86400000;
    const trans = Math.max(0, (Date.now() - inicio) / 86400000);
    idealActual = Math.min((trans / total) * 100, 100);
  }
  // Desviación vs ideal
  const desvIdeal = idealActual !== null ? avanceActual - idealActual : null;

  return <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:10}}>
    {/* KPIs principales */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
      <Kpi label="Avance actual" value={`${NUM(avanceActual,1)}%`}
        sub={oficiales.length>0?`Última semana cerrada: S${ultimoOf.semana}`:"Sin cierres oficiales"}
        color={semA(avanceActual)} size={14}/>
      <Kpi label="Esta semana" value={oficiales.length>=2?`${deltaSemana>=0?"+":""}${NUM(deltaSemana,2)}pp`:"—"}
        sub={oficiales.length>=2?`vs S${penultimoOf.semana}`:"requiere 2 cierres"}
        color={deltaSemana>=0?C.greenDk:C.red} size={12}/>
      <Kpi label="Velocidad prom." value={ult4.length>=2?`${NUM(velocidadProm,2)} pp/sem`:"—"}
        sub={`últimas ${ult4.length} sem.`} color={C.blueDk} size={12}/>
      <Kpi label="Proyección fin" value={fechaProyFin?fechaProyFin.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"2-digit"}):"—"}
        sub={desvDias!==null?(desvDias>0?`+${desvDias}d vs contrato`:desvDias<0?`${desvDias}d antes`:"en plazo"):"—"}
        color={desvDias===null?C.textMut:desvDias>15?C.red:desvDias>0?C.yellow:C.greenDk} size={12}/>
      {idealActual!==null && (
        <Kpi label="Avance ideal" value={`${NUM(idealActual,1)}%`}
          sub={desvIdeal!==null?(desvIdeal<0?`${NUM(desvIdeal,1)}pp atrasado`:`+${NUM(desvIdeal,1)}pp adelantado`):"—"}
          color={desvIdeal===null?C.textMut:desvIdeal<-5?C.red:desvIdeal<0?C.yellow:C.greenDk} size={12}/>
      )}
    </div>

    {/* Sin histórico aún */}
    {oficiales.length === 0 && (
      <Card>
        <div style={{padding:16,textAlign:"center",fontSize:11,color:C.textMut}}>
          <div style={{fontSize:13,fontWeight:600,color:C.caliza,marginBottom:6}}>
            Aún no hay cierres semanales oficiales
          </div>
          <div>Para empezar a ver tendencias, captura el avance y haz click en <b>"Cerrar semana"</b> cada viernes.</div>
        </div>
      </Card>
    )}

    {/* Detectores: partidas que requieren atención */}
    {oficiales.length > 0 && (estancadas.length>0 || retroceso.length>0 || calientes.length>0) && (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
        {calientes.length > 0 && (
          <Card accent={C.green}>
            <Tit>Partidas con mayor avance</Tit>
            <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>esta semana vs anterior</div>
            {calientes.map((s,i)=>(
              <div key={s.id || `${s.sec}-c${i}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"5px 8px",marginBottom:3,background:C.bg,borderRadius:5,fontSize:10}}>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  <span style={{color:C.textMut,fontWeight:600}}>{s.sec}</span> · <span style={{color:C.textPri}}>{s.sub}</span>
                </span>
                <span style={{color:C.greenDk,fontWeight:700,marginLeft:6}}>+{NUM(s.delta,1)}pp</span>
              </div>
            ))}
          </Card>
        )}
        {estancadas.length > 0 && (
          <Card accent={C.yellow}>
            <Tit>Partidas estancadas</Tit>
            <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>≥2 semanas sin movimiento</div>
            {estancadas.map((s,i)=>(
              <div key={s.id || `${s.sec}-e${i}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"5px 8px",marginBottom:3,background:C.bg,borderRadius:5,fontSize:10}}>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  <span style={{color:C.textMut,fontWeight:600}}>{s.sec}</span> · <span style={{color:C.textPri}}>{s.sub}</span>
                </span>
                <span style={{color:C.yellowDk,fontWeight:700,marginLeft:6}}>{s.a||0}%</span>
              </div>
            ))}
          </Card>
        )}
        {retroceso.length > 0 && (
          <Card accent={C.red}>
            <Tit>Partidas con retroceso</Tit>
            <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>posibles correcciones o re-trabajo</div>
            {retroceso.map((s,i)=>(
              <div key={s.id || `${s.sec}-r${i}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"5px 8px",marginBottom:3,background:C.bg,borderRadius:5,fontSize:10}}>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  <span style={{color:C.textMut,fontWeight:600}}>{s.sec}</span> · <span style={{color:C.textPri}}>{s.sub}</span>
                </span>
                <span style={{color:C.red,fontWeight:700,marginLeft:6}}>{NUM(s.delta,1)}pp</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    )}

    {/* Gráfica de tendencia: avance real vs ideal */}
    {oficiales.length >= 2 && (
      <Card>
        <Tit>Tendencia de avance — últimas {puntos.length} semanas</Tit>
        <GraficaTendencia puntos={puntos} idealActual={idealActual}/>
      </Card>
    )}
  </div>;
}

// ── Curva S: real vs programado a lo largo del plazo ──
function GraficaTendencia({puntos=[], idealActual=null}){
  const W = 540, H = 200, P = 32;
  const maxY = 100;
  const xs = puntos.map((p,i) => P + (i*(W-2*P)/Math.max(puntos.length-1,1)));
  const ysReal = puntos.map(p => H - P - (p.real/maxY)*(H-2*P));
  const ysProg = puntos.map(p => p.programado !== null && p.programado !== undefined
    ? H - P - (p.programado/maxY)*(H-2*P) : null);
  const pathReal = puntos.map((p,i)=>`${i===0?"M":"L"} ${xs[i]} ${ysReal[i]}`).join(" ");
  const tieneProgramado = puntos.some(p => p.programado !== null && p.programado !== undefined);
  const pathProg = tieneProgramado ? puntos.map((p,i) => {
    const y = ysProg[i];
    if (y === null) return '';
    return `${i===0?"M":"L"} ${xs[i]} ${y}`;
  }).filter(Boolean).join(" ") : null;
  return <div>
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",maxHeight:220}}>
      {/* Grid horizontal */}
      {[0, 25, 50, 75, 100].map(pct => {
        const y = H - P - (pct/maxY)*(H-2*P);
        return <g key={pct}>
          <line x1={P} y1={y} x2={W-P} y2={y} stroke={C.border} strokeDasharray="2 2"/>
          <text x={P-6} y={y+3} fontSize="9" fill={C.textMut} textAnchor="end">{pct}%</text>
        </g>;
      })}
      {/* Curva programada (lineal, plazo contractual) */}
      {pathProg && (
        <path d={pathProg} fill="none" stroke={C.textMut} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.85"/>
      )}
      {/* Línea real */}
      <path d={pathReal} fill="none" stroke={C.blueDk} strokeWidth="2.5"/>
      {/* Puntos programados */}
      {tieneProgramado && xs.map((x,i)=> ysProg[i] !== null && (
        <circle key={'p'+i} cx={x} cy={ysProg[i]} r="2.5" fill={C.textMut} opacity="0.6"/>
      ))}
      {/* Puntos reales */}
      {xs.map((x,i)=>(
        <g key={i}>
          <circle cx={x} cy={ysReal[i]} r="3.5" fill={C.blueDk}/>
          <text x={x} y={H-P+14} fontSize="9" fill={C.textSec} textAnchor="middle">{puntos[i].x}</text>
          <text x={x} y={ysReal[i]-8} fontSize="9" fill={C.caliza} fontWeight="600" textAnchor="middle">{NUM(puntos[i].real,1)}%</text>
        </g>
      ))}
    </svg>
    {/* Leyenda */}
    <div style={{display:"flex",justifyContent:"center",gap:14,marginTop:6,fontSize:9,color:C.textMut}}>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <div style={{width:12,height:2,background:C.blueDk}}/> <span>Real ejecutado</span>
      </div>
      {tieneProgramado && (
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:12,height:1.5,background:C.textMut,borderTop:`1.5px dashed ${C.textMut}`}}/> <span>Programado (lineal)</span>
        </div>
      )}
    </div>
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// EmptyState — mensaje visual para sub-tabs sin datos capturados
// ════════════════════════════════════════════════════════════════════════════
// Props:
//   titulo: string (ej. "Sin catálogo cargado")
//   mensaje: string corto explicando qué hacer
//   cta: { label: string, onClick: fn } botón principal (opcional)
//   pasos: array de strings con pasos detallados (opcional)
function EmptyState({titulo, mensaje, cta, pasos}){
  return <Card style={{background:C.bg, border:`0.5px dashed ${C.borderM}`, marginTop:6}}>
    <div style={{padding:"22px 18px", textAlign:"center"}}>
      <div style={{fontSize:13, fontWeight:700, color:C.caliza, marginBottom:6}}>{titulo}</div>
      <div style={{fontSize:11, color:C.textSec, marginBottom:cta||pasos?14:0,
        maxWidth:400, margin:"0 auto", lineHeight:1.5}}>
        {mensaje}
      </div>
      {pasos && (
        <div style={{margin:"14px auto 0", maxWidth:380, textAlign:"left",
          background:C.surface, borderRadius:8, padding:"12px 14px",
          border:`0.5px solid ${C.border}`}}>
          {pasos.map((p,i) => (
            <div key={i} style={{fontSize:10, color:C.textSec, marginBottom:6,
              display:"flex", alignItems:"flex-start", gap:8}}>
              <span style={{width:18, height:18, borderRadius:"50%", background:C.caliza,
                color:C.bg, fontSize:10, fontWeight:700, display:"flex",
                alignItems:"center", justifyContent:"center", flexShrink:0}}>{i+1}</span>
              <span style={{paddingTop:2}}>{p}</span>
            </div>
          ))}
        </div>
      )}
      {cta && (
        <button onClick={cta.onClick}
          style={{marginTop:14, background:C.caliza, color:C.bg, border:"none",
            borderRadius:6, padding:"8px 18px", fontSize:11, fontWeight:600,
            cursor:"pointer"}}>
          {cta.label}
        </button>
      )}
    </div>
  </Card>;
}

// ════════════════════════════════════════════════════════════════════════════
// MINI-DASHBOARDS por sub-tab de Operación
// ════════════════════════════════════════════════════════════════════════════

// ── ALMACÉN ──
function MiniDashAlmacen({obra, materiales}){
  const total = (materiales||[]).reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  const enAlmacen = (materiales||[]).filter(m=>m.concepto==='En almacén').reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  const enTransito = (materiales||[]).filter(m=>m.concepto==='En tránsito').reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  const enFabricacion = (materiales||[]).filter(m=>m.concepto==='En fabricación').reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  const anticipo = (materiales||[]).filter(m=>m.concepto==='Anticipo').reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  const items = (materiales||[]).filter(m => (parseFloat(m.imp)||0) > 0).length;
  const pctPresupuesto = obra.presupuesto > 0 ? total/obra.presupuesto*100 : 0;
  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:10}}>
    <Kpi label="Total almacén" value={MXN(total)} sub={`${items} item${items===1?'':'s'} activos`} color={C.blueDk} size={12}/>
    <Kpi label="En almacén" value={MXN(enAlmacen)} sub="disponible en obra" color={CT_COL['En almacén']} size={12}/>
    <Kpi label="En tránsito" value={MXN(enTransito)} sub="en camino" color={CT_COL['En tránsito']} size={12}/>
    <Kpi label="En fabricación" value={MXN(enFabricacion)} sub="pendiente entrega" color={CT_COL['En fabricación']} size={12}/>
    {anticipo > 0 && <Kpi label="Anticipo" value={MXN(anticipo)} sub="dado a proveedores" color={CT_COL['Anticipo']} size={12}/>}
    <Kpi label="% presupuesto" value={`${NUM(pctPresupuesto,1)}%`} sub="del contrato" color={C.caliza} size={12}/>
  </div>;
}

// ── MAQUINARIA ──
function MiniDashMaquinaria({obra, maquinaria}){
  const total = (maquinaria||[]).reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  const items = (maquinaria||[]).filter(m => (parseFloat(m.imp)||0) > 0).length;
  const sinAsignar = (maquinaria||[]).filter(m => !m.desc).length;
  const pctPresupuesto = obra.presupuesto > 0 ? total/obra.presupuesto*100 : 0;
  // Top 3 más caras
  const top3 = [...(maquinaria||[])].filter(m => (parseFloat(m.imp)||0) > 0).sort((a,b)=>(parseFloat(b.imp)||0)-(parseFloat(a.imp)||0)).slice(0,3);
  const top3Total = top3.reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);
  return <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
      <Kpi label="Costo total" value={MXN(total)} sub="acumulado" color={C.orange} size={12}/>
      <Kpi label="Equipos activos" value={String(items)} sub={`${sinAsignar} slots vacíos`} color={C.blueDk} size={12}/>
      <Kpi label="% presupuesto" value={`${NUM(pctPresupuesto,1)}%`} sub={pctPresupuesto > 8 ? "elevado" : "dentro de rango"} color={pctPresupuesto > 8 ? C.yellow : C.greenDk} size={12}/>
      {items > 0 && <Kpi label="Costo promedio" value={MXN(total/items)} sub="por equipo" color={C.purple} size={12}/>}
    </div>
    {top3.length > 0 && (
      <Card style={{padding:"10px 12px"}}>
        <div style={{fontSize:10,color:C.textMut,fontWeight:600,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>Top 3 equipos por costo</div>
        {top3.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,padding:"4px 0",borderBottom:i<2?`0.5px solid ${C.border}`:'none'}}>
            <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              <span style={{color:C.textMut,fontWeight:600}}>#{i+1}</span> · <span style={{color:C.textPri}}>{m.desc}</span>
            </span>
            <span style={{color:C.orange,fontWeight:600}}>{MXN(parseFloat(m.imp)||0)}</span>
          </div>
        ))}
      </Card>
    )}
  </div>;
}

// ── NÓMINA ──
function MiniDashNomina(){
  const totalNom = NOMINA_S18.reduce((t,p)=>t+(p.total||0), 0);
  const totalHE = NOMINA_S18.reduce((t,p)=>t+(p.importeHE||0), 0);
  const totalDias = NOMINA_S18.reduce((t,p)=>t+(p.importeDias||0), 0);
  const directos = NOMINA_S18.filter(p=>p.tipo==='D');
  const indirectos = NOMINA_S18.filter(p=>p.tipo==='I');
  const trabajadoresActivos = NOMINA_S18.filter(p=>(p.total||0) > 0).length;
  const inasistentes = NOMINA_S18.filter(p=>(p.diasTrabajados||0) === 0).length;
  const altasHE = NOMINA_S18.filter(p=>(p.horasExtra||0) >= 20).length;
  const pctHE = totalNom > 0 ? totalHE/totalNom*100 : 0;
  return <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
      <Kpi label="Total nómina S18" value={MXN(totalNom)} sub="semana actual" color={C.caliza} size={12}/>
      <Kpi label="Activos" value={String(trabajadoresActivos)} sub={`${directos.length}D · ${indirectos.length}I`} color={C.green}/>
      <Kpi label="Horas extra" value={MXN(totalHE)} sub={`${NUM(pctHE,1)}% del total`} color={pctHE > 15 ? C.yellowDk : C.blueDk} size={12}/>
      <Kpi label="Sueldos base" value={MXN(totalDias)} sub="jornadas" color={C.purpleDk} size={12}/>
      {altasHE > 0 && <Kpi label="Riesgo HE" value={String(altasHE)} sub={`≥20h ext.`} color={C.yellow}/>}
      {inasistentes > 0 && <Kpi label="Sin asistencia" value={String(inasistentes)} sub="esta semana" color={C.red}/>}
    </div>
  </div>;
}

// ── ESTIMACIONES ──
function MiniDashEstimaciones({obra, estimaciones}){
  const totalEst = estimaciones.reduce((t,e)=>t+(e.monto||0), 0);
  const pagado = estimaciones.filter(e=>e.estatus==='Pagada').reduce((t,e)=>t+(e.monto||0), 0);
  const porCobrar = estimaciones.filter(e=>['Facturada','Aprobada'].includes(e.estatus)).reduce((t,e)=>t+(e.monto||0), 0);
  const enProceso = estimaciones.filter(e=>e.estatus==='En proceso').reduce((t,e)=>t+(e.monto||0), 0);
  const porEstimar = Math.max(obra.presupuesto - totalEst, 0);
  const diasPago = obra.diasPago || 30;
  const hoy = new Date();
  const atrasadas = estimaciones.filter(e => {
    if (e.estatus !== 'Facturada' || !e.fechaFact) return false;
    return Math.floor((hoy - new Date(e.fechaFact))/86400000) > diasPago;
  });
  const montoAtrasado = atrasadas.reduce((t,e)=>t+(e.monto||0), 0);
  return <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
      <Kpi label="Total estimado" value={MXN(totalEst)} sub={`${NUM(totalEst/obra.presupuesto*100,1)}% del contrato`} color={C.caliza} size={12}/>
      <Kpi label="Pagado" value={MXN(pagado)} sub="cobrado y liquidado" color={C.greenDk} size={12}/>
      <Kpi label="Por cobrar" value={MXN(porCobrar)} sub={atrasadas.length > 0 ? `${atrasadas.length} atrasada(s)` : "facturado+aprobado"} color={atrasadas.length > 0 ? C.red : C.purpleDk} size={12}/>
      <Kpi label="En proceso" value={MXN(enProceso)} sub="en elaboración" color={C.yellowDk} size={12}/>
      <Kpi label="Por estimar" value={MXN(porEstimar)} sub="saldo del contrato" color={C.blueDk} size={12}/>
      {montoAtrasado > 0 && <Kpi label="Atrasado" value={MXN(montoAtrasado)} sub={`plazo: ${diasPago}d`} color={C.red} size={12}/>}
    </div>
  </div>;
}

// ── SUBCONTRATOS ──
function MiniDashSubcontratos({obra, subcontratos}){
  if (!subcontratos?.length) return null;
  const totalContratado = subcontratos.reduce((t,s)=>t+(s.monto||0), 0);
  const totalEjec = subcontratos.reduce((t,s) => {
    const ejec = s.conceptos?.reduce((tt,c)=>tt+((c.avance||0)/100)*(c.importe||0), 0) || 0;
    return t + ejec;
  }, 0);
  const totalPagado = subcontratos.reduce((t,s) => {
    return t + (s.pagos?.filter(p=>p.estatus==='pagado').reduce((tt,p)=>tt+(p.monto||0), 0) || 0);
  }, 0);
  const totalCat = subcontratos.reduce((t,s) => t + (s.conceptos?.reduce((tt,c)=>tt+(c.importe||0), 0) || 0), 0);
  const pctAvanceProm = totalCat > 0 ? totalEjec/totalCat*100 : 0;
  const pctPagado = totalContratado > 0 ? totalPagado/totalContratado*100 : 0;
  const activos = subcontratos.filter(s => s.estado === 'activa').length;
  const completados = subcontratos.filter(s => s.estado === 'completada').length;
  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:10}}>
    <Kpi label="Total contratado" value={MXN(totalContratado)} sub={`${subcontratos.length} sub${subcontratos.length===1?'':'s'} · ${activos} activos`} color={C.caliza} size={12}/>
    <Kpi label="Avance físico" value={`${NUM(pctAvanceProm,1)}%`} sub={`${MXN(totalEjec)} ejecutado`} color={pctAvanceProm>=100?C.green:C.blue} size={12}/>
    <Kpi label="Avance financiero" value={`${NUM(pctPagado,1)}%`} sub={`${MXN(totalPagado)} pagado`} color={pctPagado>=100?C.green:C.purpleDk} size={12}/>
    <Kpi label="Por pagar" value={MXN(Math.max(totalContratado - totalPagado, 0))} sub="saldo a proveedores" color={C.blueDk} size={12}/>
    {completados > 0 && <Kpi label="Completados" value={String(completados)} sub="cerrados" color={C.green}/>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// OPERACIÓN — Wrapper con sub-tabs: lo que se reporta semana a semana
// (Avance · Almacén · Maquinaria · Nómina · Estimaciones · Subcontratos)
// Cada sub-tab tiene su propio mini-dashboard arriba (Sprint B).
// ════════════════════════════════════════════════════════════════════════════
function Operacion({subTab,setSubTab,obra,setObra,rol,usuario,
                   subs,setSubs,maquinaria,setMaquinaria,materiales,setMateriales,
                   estimaciones,setEstimaciones,subcontratos,setSubcontratos,
                   historialAvance,setHistorialAvance,setCambiosPendientes,onNavTab}){
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {/* Sub-tabs */}
    <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0,
      background:C.surface,padding:"6px 4px",borderRadius:8,border:`0.5px solid ${C.border}`,marginBottom:2}}>
      {SUBTABS_OPERACION.map(t => (
        <button key={t.id} onClick={()=>setSubTab(t.id)}
          style={{flex:"0 0 auto",padding:"7px 14px",fontSize:11,borderRadius:6,
            background: subTab===t.id ? C.caliza : "transparent",
            border:"none",
            color: subTab===t.id ? C.bg : C.textSec,
            fontWeight: subTab===t.id ? 700 : 400, whiteSpace:"nowrap", cursor:"pointer"}}>
          {t.label}
        </button>
      ))}
    </div>

    {/* RESUMEN: mini-dashboard de operación con accesos rápidos */}
    {subTab==="resumen" && (
      <Card>
        <Tit>Resumen de Operación</Tit>
        <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:10}}>
          Reporte semanal de la obra. Selecciona la sección que quieres actualizar.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
          {SUBTABS_OPERACION.filter(t=>t.id!=="resumen").map(t => (
            <div key={t.id} onClick={()=>setSubTab(t.id)}
              style={{background:C.bg,borderRadius:8,padding:"14px 12px",cursor:"pointer",
                border:`0.5px solid ${C.border}`,transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.caliza;e.currentTarget.style.transform="translateY(-1px)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.transform="";}}>
              <div style={{fontSize:12,fontWeight:700,color:C.caliza,marginBottom:3}}>{t.label}</div>
              <div style={{fontSize:9,color:C.textMut}}>Abrir ›</div>
            </div>
          ))}
        </div>
      </Card>
    )}

    {/* AVANCE FÍSICO + FOTOS (la pestaña Volúmenes de Captura) — con mini-dashboard histórico arriba */}
    {subTab==="avance" && (
      <>
        <MiniDashAvance obra={obra} subs={subs} historialAvance={historialAvance}/>
        <Captura subs={subs} setSubs={setSubs} maquinaria={maquinaria} setMaquinaria={setMaquinaria}
          materiales={materiales} setMateriales={setMateriales}
          rol={rol} obra={obra} forceTab="volumenes"
          usuario={usuario} historialAvance={historialAvance} setHistorialAvance={setHistorialAvance}
          setCambiosPendientes={setCambiosPendientes} onNavTab={onNavTab}/>
      </>
    )}
    {subTab==="almacen" && (
      <>
        <MiniDashAlmacen obra={obra} materiales={materiales}/>
        <Captura subs={subs} setSubs={setSubs} maquinaria={maquinaria} setMaquinaria={setMaquinaria}
          materiales={materiales} setMateriales={setMateriales}
          rol={rol} obra={obra} forceTab="materiales"
          usuario={usuario} historialAvance={historialAvance} setHistorialAvance={setHistorialAvance}
          setCambiosPendientes={setCambiosPendientes} onNavTab={onNavTab}/>
      </>
    )}
    {subTab==="maquinaria" && (
      <>
        <MiniDashMaquinaria obra={obra} maquinaria={maquinaria}/>
        <Captura subs={subs} setSubs={setSubs} maquinaria={maquinaria} setMaquinaria={setMaquinaria}
          materiales={materiales} setMateriales={setMateriales}
          rol={rol} obra={obra} forceTab="maquinaria"
          usuario={usuario} historialAvance={historialAvance} setHistorialAvance={setHistorialAvance}
          setCambiosPendientes={setCambiosPendientes} onNavTab={onNavTab}/>
      </>
    )}
    {subTab==="nomina" && (
      <>
        <MiniDashNomina/>
        <Captura subs={subs} setSubs={setSubs} maquinaria={maquinaria} setMaquinaria={setMaquinaria}
          materiales={materiales} setMateriales={setMateriales}
          rol={rol} obra={obra} forceTab="nomina"
          usuario={usuario} historialAvance={historialAvance} setHistorialAvance={setHistorialAvance}
          setCambiosPendientes={setCambiosPendientes} onNavTab={onNavTab}/>
      </>
    )}
    {subTab==="estimaciones" && (
      <>
        <MiniDashEstimaciones obra={obra} estimaciones={estimaciones}/>
        <Estimaciones obra={obra} setObra={setObra} estimaciones={estimaciones} setEstimaciones={setEstimaciones} rol={rol} usuario={usuario}/>
      </>
    )}
    {subTab==="subcontratos" && (
      <>
        <MiniDashSubcontratos obra={obra} subcontratos={subcontratos}/>
        <Subcontratos obra={obra} rol={rol} items={subcontratos} setItems={setSubcontratos} usuario={usuario}/>
      </>
    )}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// PLANEACIÓN — Wrapper con sub-tabs: lo que define la obra (Contrato · Presupuesto)
// ════════════════════════════════════════════════════════════════════════════
function Planeacion({subTab,setSubTab,obra,setObra,rol,setSubsGlobal}){
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0,
      background:C.surface,padding:"6px 4px",borderRadius:8,border:`0.5px solid ${C.border}`,marginBottom:2}}>
      {SUBTABS_PLANEACION.map(t => (
        <button key={t.id} onClick={()=>setSubTab(t.id)}
          style={{flex:"0 0 auto",padding:"7px 14px",fontSize:11,borderRadius:6,
            background: subTab===t.id ? C.caliza : "transparent",
            border:"none",
            color: subTab===t.id ? C.bg : C.textSec,
            fontWeight: subTab===t.id ? 700 : 400, whiteSpace:"nowrap", cursor:"pointer"}}>
          {t.label}
        </button>
      ))}
    </div>
    {subTab==="contrato" && <Contrato obra={obra} setObra={setObra} rol={rol}/>}
    {subTab==="presupuesto" && <Presupuesto obra={obra} setObra={setObra} rol={rol} setSubsGlobal={setSubsGlobal}/>}
    {subTab==="permisos" && <PermisosObra obra={obra} rol={rol}/>}
  </div>;
}

// ── CAPTURA ────────────────────────────────────────────────────────────────
function Captura({subs,setSubs,maquinaria,setMaquinaria,materiales,setMateriales,rol,obra,forceTab,usuario,historialAvance,setHistorialAvance,setCambiosPendientes,onNavTab}){
  // Estados para "el usuario ya empezó a agregar" — fuerza a mostrar la tabla
  // aunque el item recién agregado aún no tenga descripción
  const[agregandoMaq, setAgregandoMaq] = useState(false);
  const[agregandoMat, setAgregandoMat] = useState(false);
  // Reset al cambiar de obra
  useEffect(() => { setAgregandoMaq(false); setAgregandoMat(false); }, [obra?.id]);
  // Tienen datos reales? (descartando placeholders vacíos)
  const maqReal = maquinaria.filter(m => m.desc && m.desc.trim()).length > 0;
  const matReal = materiales.filter(m => m.desc && m.desc.trim()).length > 0;
  const mostrarTablaMaq = maqReal || agregandoMaq;
  const mostrarTablaMat = matReal || agregandoMat;
  // Si forceTab viene (porque el wrapper Operación define qué sub-tab mostrar),
  // ocultamos las tabs internas y usamos el tab forzado.
  const[tabLocal,setTab]=useState("volumenes");
  const tab = forceTab || tabLocal;
  const ocultarTabs = !!forceTab;
  const[exp,setExp]=useState({});
  const editar=can(rol,"captura","editar");
  // Sube la foto a Firebase Storage y guarda solo la URL en Firestore (no base64).
  // Esto evita que el documento Firestore crezca demasiado y permite cargar
  // miles de fotos sin afectar el rendimiento de carga.
  // addFoto/delFoto reciben el id ÚNICO de la sub (no la clave sec, que puede repetirse)
  const addFoto = async (subId, foto) => {
    if (!obra?.id) return;
    try {
      const idSafe = (foto.id || Date.now()).toString();
      let urlFinal = foto.url;
      if (foto.url && foto.url.startsWith('data:')) {
        urlFinal = await uploadFoto(obra.id, `avance_${subId}`, idSafe, foto.url);
      }
      setSubs(ss => ss.map(s => {
        if (s.id !== subId) return s;
        const fotosObj = s.fotos || {};
        // Las fotos se guardan bajo la clave del id (no sec) para evitar colisiones
        return {...s, fotos:{...fotosObj, [subId]:[...(fotosObj[subId] || fotosObj[s.sec] || []), {id: idSafe, url: urlFinal, fecha: new Date().toISOString().slice(0,10)}]}};
      }));
    } catch (e) {
      console.error('addFoto error', e);
      alert('Error al subir foto: ' + (e.message || 'desconocido'));
    }
  };
  const delFoto=(subId, fotoId)=>setSubs(ss=>ss.map(s=>{
    if(s.id !== subId) return s;
    const fotosObj = s.fotos || {};
    const lista = fotosObj[subId] || fotosObj[s.sec] || [];
    return {...s, fotos:{...fotosObj, [subId]: lista.filter(f=>f.id!==fotoId)}};
  }));
  const rMaq=(i,f,v)=>setMaquinaria(mm=>mm.map((m,j)=>{if(j!==i)return m;const u={...m,[f]:v};u.imp=Math.round((parseFloat(u.vol)||0)*(parseFloat(u.pu)||0));return u;}));
  const rMat=(i,f,v)=>setMateriales(mm=>mm.map((m,j)=>{if(j!==i)return m;const u={...m,[f]:v};u.imp=Math.round((parseFloat(u.vol)||0)*(parseFloat(u.pu)||0));return u;}));

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {!editar&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
       Vista de solo lectura — tu rol no tiene permiso para editar este módulo.
    </div>}
    {!ocultarTabs && <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0,paddingBottom:1}}>
      {[["volumenes","Volúmenes"],["maquinaria","Maquinaria"],["materiales","Almacén"],["nomina","Nómina"]].map(([id,lbl])=>
        <button key={id} onClick={()=>setTab(id)} style={{flex:"0 0 auto",padding:"7px 14px",fontSize:11,borderRadius:8,
          background:tab===id?C.caliza:C.card,border:`0.5px solid ${tab===id?C.caliza:C.border}`,
          color:tab===id?C.bg:C.textSec,fontWeight:tab===id?700:400,whiteSpace:"nowrap"}}>{lbl}</button>)}
    </div>}

    {tab==="volumenes" && subs.filter(s => (s.imp||0) > 0).length === 0 && (
      <EmptyState
        titulo="Aún no hay catálogo de presupuesto"
        mensaje="Antes de capturar avance físico necesitas cargar el catálogo de conceptos de esta obra. Es lo que define qué subsecciones hay y cuánto pesa cada una."
        cta={onNavTab ? {
          label: "Ir a Planeación → Presupuesto",
          onClick: () => onNavTab("planeacion", "presupuesto"),
        } : null}
        pasos={[
          "Ve a la pestaña Planeación → Presupuesto.",
          "Sube tu archivo Excel o CSV con el catálogo de conceptos.",
          "Confirma. El catálogo aparece automáticamente aquí para capturar avance."
        ]}/>
    )}
    {tab==="volumenes" && subs.filter(s => (s.imp||0) > 0).length > 0 && <Card>
      <Tit>Avance por concepto</Tit>
      {(() => {
        // ── Construir ÁRBOL JERÁRQUICO desde la ruta de ancestros de cada concepto
        // Cada nodo: { tipo:"categoria", clave, desc, nivel, hijos:[] } o
        //            { tipo:"concepto", sub } (hoja)
        const subsConImp = subs.filter(s => (s.imp||0) > 0);
        const raiz = { tipo: 'categoria', clave: '__root__', desc: '', nivel: 0, hijos: [] };
        const nodoPorClave = new Map();  // clave categoría → nodo
        nodoPorClave.set('__root__', raiz);

        subsConImp.forEach(s => {
          const ruta = Array.isArray(s.ruta) ? s.ruta : [];
          let padre = raiz;
          // Crear/encontrar cada categoría ancestro
          ruta.forEach(catInfo => {
            let nodo = nodoPorClave.get(catInfo.clave);
            if (!nodo) {
              nodo = {
                tipo: 'categoria',
                clave: catInfo.clave,
                desc: catInfo.desc || '',
                nivel: catInfo.nivel || (padre.nivel + 1),
                hijos: [],
              };
              nodoPorClave.set(catInfo.clave, nodo);
              padre.hijos.push(nodo);
            }
            padre = nodo;
          });
          // Agregar el concepto como hoja en su categoría más profunda (o raíz si huérfano)
          padre.hijos.push({ tipo: 'concepto', sub: s });
        });

        // Calcular agregados (totalImporte, avancePonderado, count) por nodo recursivamente
        const calcAgreg = (nodo) => {
          if (nodo.tipo === 'concepto') {
            return { imp: nodo.sub.imp || 0, avPond: (nodo.sub.a || 0) * (nodo.sub.imp || 0), count: 1 };
          }
          let imp = 0, avPond = 0, count = 0;
          nodo.hijos.forEach(h => {
            const a = calcAgreg(h);
            imp += a.imp; avPond += a.avPond; count += a.count;
          });
          nodo._agreg = { imp, avPond, count, av: imp > 0 ? avPond / imp : 0 };
          return { imp, avPond, count };
        };
        raiz.hijos.forEach(calcAgreg);

        // Renderiza un concepto individual (sub).
        // Es la hoja del árbol — todo está siempre visible inline:
        // descripción, importe, input de % avance y cuadro de fotos.
        // No requiere ningún expandir/colapsar extra.
        const renderConcepto = (s, indentLevel = 0) => {
          const subId = s.id || s.sec;
          const fotosObj = s.fotos || {};
          const fotosArr = fotosObj[subId] || fotosObj[s.sec] || [];
          const nF = fotosArr.length;
          return <div key={subId} style={{background:C.bg,borderRadius:8,padding:"8px 10px",marginBottom:5,
            marginLeft: indentLevel * 16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5,gap:8}}>
              <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:9,fontWeight:700,color:C.caliza}}>{s.sec}</span>
                  <span style={{fontSize:11,color:C.textSec,overflow:"hidden",textOverflow:"ellipsis"}}>{s.sub}</span>
                  {nF>0&&<Bdg color={C.purple} small>{nF}</Bdg>}
                </div>
                <div style={{fontSize:9,color:C.textMut,marginTop:1}}>{MXN(s.imp)}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                {editar?<><input type="number" min="0" max="100" placeholder="0" value={s.a||""}
                  onChange={e=>setSubs(ss=>ss.map(x=>x.id===subId?{...x,a:Math.min(100,Math.max(0,parseFloat(e.target.value)||0))}:x))}
                  style={{background:C.surface,border:`0.5px solid ${C.borderM}`,borderRadius:6,
                    padding:"3px 6px",fontSize:12,width:50,textAlign:"right",color:C.textPri,outline:"none"}}/>
                <span style={{fontSize:10,color:C.textMut}}>%</span></>
                :<span style={{fontSize:13,fontWeight:700,color:semA(s.a||0)}}>{s.a||0}%</span>}
              </div>
            </div>
            <Bar pct={s.a||0} color={semA(s.a||0)}/>
            {/* Cuadro de fotos siempre visible inline */}
            <div style={{marginTop:8}}>
              <ConceptoFotos
                fotos={fotosArr}
                onAdd={editar ? (foto=>addFoto(subId, foto)) : (()=>{})}
                onDel={editar ? (id=>delFoto(subId, id)) : (()=>{})}/>
              {!editar && fotosArr.length === 0 && (
                <div style={{fontSize:9,color:C.textMut,padding:"4px 0"}}>Sin fotos cargadas.</div>
              )}
            </div>
          </div>;
        };

        // Render RECURSIVO: cada categoría puede contener sub-categorías y/o conceptos.
        // Los colores y tamaños cambian sutilmente según nivel (más oscuro/grande arriba).
        const renderNodo = (nodo, indent = 0) => {
          if (nodo.tipo === 'concepto') {
            return renderConcepto(nodo.sub, indent);
          }
          // Categoría
          const catId = `__cat__${nodo.clave}__${nodo.nivel}`;
          // Default: nivel 1 colapsado; niveles más profundos también colapsados
          // para no abrumar al usuario al abrir la pantalla
          const expanded = exp[catId] === true;
          const ag = nodo._agreg || { imp: 0, avPond: 0, count: 0, av: 0 };
          const av = ag.av || 0;
          // Estilo por nivel: nivel 1 = oscuro caliza, nivel 2 = azul oscuro, nivel 3+ = gris claro
          const stylesPorNivel = {
            1: { bg: C.caliza,  fg: C.bg,      claveColor: C.bg,        descOpacity: 0.95, fz: 12, fzClave: 12 },
            2: { bg: C.blueDk,  fg: '#fff',    claveColor: '#fff',      descOpacity: 0.9,  fz: 11, fzClave: 11 },
            3: { bg: '#3a4855', fg: '#fff',    claveColor: '#fff',      descOpacity: 0.85, fz: 10.5, fzClave: 10.5 },
            4: { bg: '#e8eaf0', fg: C.textPri, claveColor: C.caliza,    descOpacity: 1,    fz: 10, fzClave: 10 },
          };
          const st = stylesPorNivel[nodo.nivel] || stylesPorNivel[4];
          return <div key={catId} style={{marginBottom: 5, marginLeft: indent * 14}}>
            <div onClick={()=>setExp(e=>({...e, [catId]: !expanded}))}
              style={{background: st.bg, color: st.fg, borderRadius: 8,
                padding: nodo.nivel === 1 ? "10px 12px" : "8px 11px",
                cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
                marginBottom: expanded ? 5 : 0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,overflow:"hidden"}}>
                <span style={{fontSize:12}}>{expanded?"▾":"▸"}</span>
                <span style={{fontSize: st.fzClave, fontWeight:700, letterSpacing:"0.04em", flexShrink:0, color: st.claveColor}}>
                  {nodo.clave}
                </span>
                <span style={{fontSize: st.fz, opacity: st.descOpacity, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                  {nodo.desc || ''}
                </span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0,fontSize:10}}>
                <span style={{opacity:0.75}}>{ag.count} concepto{ag.count!==1?"s":""}</span>
                <span style={{opacity:0.75}}>{MXN(ag.imp)}</span>
                <span style={{fontWeight:700, fontSize:12,
                  color: av>=75 ? "#a8d979" : av>=40 ? "#f3b658" : av>0 ? "#f08e8d" : (nodo.nivel <= 3 ? st.fg : C.textMut)}}>
                  {av.toFixed(0)}%
                </span>
              </div>
            </div>
            {expanded && nodo.hijos.map(h => renderNodo(h, indent + 1))}
          </div>;
        };

        return <>{raiz.hijos.map(h => renderNodo(h, 0))}</>;
      })()}
    </Card>}

    {tab==="maquinaria" && !mostrarTablaMaq && (
      <EmptyState
        titulo="Sin maquinaria propia registrada"
        mensaje="Aquí registras los equipos de FOSMON asignados a esta obra (retroexcavadoras, compactadores, plantas, etc.). Suma al gasto total."
        cta={editar ? {
          label: "+ Agregar primer equipo",
          onClick: () => {
            setMaquinaria(mm=>{
              const conDatos = mm.filter(m => m.desc && m.desc.trim());
              return [...conDatos, {id:Date.now(),desc:"",vol:"",und:"Mes",pu:"",imp:0}];
            });
            setAgregandoMaq(true);
          },
        } : null}
        pasos={editar ? [
          "Click en '+ Agregar primer equipo'.",
          "Captura descripción, volumen, unidad (Mes/Día) y precio unitario.",
          "El importe se calcula automáticamente. Guarda registro al terminar."
        ] : null}/>
    )}
    {tab==="maquinaria" && mostrarTablaMaq && <Card>
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

    {tab==="materiales" && !mostrarTablaMat && (
      <EmptyState
        titulo="Sin materiales en almacén registrados"
        mensaje="Registra los materiales que están en obra, en tránsito o en fabricación. Suma al Monto Ejecutado aunque aún no estén instalados."
        cta={editar ? {
          label: "+ Agregar primer material",
          onClick: () => {
            setMateriales(mm=>{
              const conDatos = mm.filter(m => m.desc && m.desc.trim());
              return [...conDatos, {id:Date.now(),desc:"",concepto:"En almacén",vol:"",und:"PZA",pu:"",imp:0}];
            });
            setAgregandoMat(true);
          },
        } : null}
        pasos={editar ? [
          "Click en '+ Agregar primer material'.",
          "Captura descripción, condición (En almacén/En tránsito/En fabricación/Anticipo), volumen, unidad y precio unitario.",
          "Mantén actualizada esta lista para que el margen de obra sea real."
        ] : null}/>
    )}
    {tab==="materiales" && mostrarTablaMat && <Card>
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

    {tab!=="nomina"&&editar&&<GuardarAvanceBtn obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales}
      onSaved={()=>{ if (setCambiosPendientes) setCambiosPendientes(false); }} usuario={usuario}
      onHistorialNuevo={(snap)=>{
        if (!setHistorialAvance) return;
        setHistorialAvance(hist => {
          const arr = (hist||[]).slice();
          const idx = arr.findIndex(s => s.id === snap.id);
          if (idx >= 0) arr[idx] = snap; else arr.push(snap);
          return arr.sort((a,b) => (a.año - b.año) || (a.semana - b.semana));
        });
      }}/>}
  </div>;
}

// ── GASTOS GP ──────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// GASTOS — Análisis completo de datos de GP Construct
// 4 sub-tabs: Resumen · Proveedores · Rubros · Semanas
// ════════════════════════════════════════════════════════════════════════════
function GastosGP({obra,maquinaria,rol,gpData,gpLoading,gpError,gpUltActualiz,onRefreshGP,cargarDetalleObra,gpDetalles}){
  // Cargar detalle (rubros + proveedores) de esta obra al montar
  useEffect(() => {
    if (!gpData?.obras || !cargarDetalleObra) return;
    const obraGPMatch = Object.values(gpData.obras).find(o =>
      o.id === obra.gpId || o.id === obra.id?.slice(0,4)
    );
    if (obraGPMatch && !gpDetalles?.[obraGPMatch.id]) {
      cargarDetalleObra(obraGPMatch.id);
    }
  }, [obra.id, obra.gpId, gpData, cargarDetalleObra, gpDetalles]);
  const[subtab,setSubtab]=useState("resumen");
  const totalMaq = maquinaria.reduce((t,m)=>t+(parseFloat(m.imp)||0), 0);

  // ── OTROS GASTOS (manuales, fuera de GP) ──
  // Lista editable por obra. Se suman al gasto total y aparecen en el desglose.
  // Útil para conceptos que no están en GP Construct (pagos directos, conciliaciones, etc.)
  const[otrosGastos, setOtrosGastos] = useState([]);
  const[otrosLoaded, setOtrosLoaded] = useState(false);
  const[otrosSaving, setOtrosSaving] = useState(false);
  const puedeEditarOtros = can(rol, 'gastos', 'editar');
  useEffect(() => {
    if (!obra?.id) return;
    fsGet(`obras/${obra.id}/config/otros_gastos`).then(d => {
      setOtrosGastos(Array.isArray(d?.items) ? d.items : []);
      setOtrosLoaded(true);
    });
  }, [obra?.id]);
  const totalOtrosGastos = otrosGastos.reduce((t,g)=>t+(parseFloat(g.importe)||0), 0);
  async function guardarOtros(nuevos) {
    setOtrosSaving(true);
    setOtrosGastos(nuevos);
    await fsSetA(`obras/${obra.id}/config/otros_gastos`, { items: nuevos },
      { modulo:"gastos", entidad:`otros gastos (${nuevos.length})`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre,
        meta:{ totalOtros: nuevos.reduce((t,g)=>t+(parseFloat(g.importe)||0),0) } });
    setOtrosSaving(false);
  }
  function agregarOtroGasto() {
    guardarOtros([...otrosGastos, {
      id: Date.now(), concepto: "", importe: 0, fecha: new Date().toISOString().slice(0,10), notas: ""
    }]);
  }
  function actualizarOtroGasto(id, campo, valor) {
    const nuevos = otrosGastos.map(g => g.id===id ? {...g, [campo]: valor} : g);
    setOtrosGastos(nuevos); // optimista
  }
  function commitOtroGasto() { guardarOtros(otrosGastos); }
  function eliminarOtroGasto(id) {
    if (!window.confirm("¿Eliminar este gasto?")) return;
    guardarOtros(otrosGastos.filter(g=>g.id!==id));
  }

  // ── Buscar la obra en gpData ──
  // Estrategia (en orden de prioridad):
  // 1. Si la obra tiene campo gpId capturado en Contrato (ej. "0114"), usarlo exacto
  // 2. Si el id de CAMPO es de 4 dígitos, intentar match directo (legacy)
  // 3. Match por similitud de nombre (normalizado: sin acentos, mayúsculas, palabras significativas)
  const normalizar = (s) => (s||"")
    .toString()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^\w\s]/g, " ")  // quita puntuación
    .replace(/\s+/g, " ")
    .trim();

  const buscarObraEnGP = () => {
    if (!gpData?.obras) return null;
    const obrasGPArr = Object.values(gpData.obras);
    // 1. Por gpId explícito
    if (obra.gpId) {
      const exact = obrasGPArr.find(o => o.id === obra.gpId);
      if (exact) return exact;
    }
    // 2. Por id de CAMPO si parece código de 4 dígitos
    if (/^\d{4}/.test(obra.id||"")) {
      const exact = obrasGPArr.find(o => o.id === obra.id.slice(0,4));
      if (exact) return exact;
    }
    // 3. Match por nombre normalizado: contiene palabras significativas
    const nombreObra = normalizar(obra.nombre);
    const palabrasObra = nombreObra.split(" ").filter(w => w.length > 3);
    let mejorMatch = null;
    let mejorScore = 0;
    for (const o of obrasGPArr) {
      const nombreGP = normalizar(o.nombre).replace(/^\d{4}\s*/, ""); // quita el código
      const palabrasGP = nombreGP.split(" ").filter(w => w.length > 3);
      // Calcular cuántas palabras significativas coinciden
      const matches = palabrasObra.filter(p => palabrasGP.some(g => g.includes(p) || p.includes(g)));
      if (matches.length > mejorScore) {
        mejorScore = matches.length;
        mejorMatch = o;
      }
    }
    // Solo aceptar match si comparten al menos 2 palabras significativas
    return mejorScore >= 2 ? mejorMatch : null;
  };

  const datosObraResumen = buscarObraEnGP();
  // Detalle (rubros + proveedores) viene del cache de detalles si está disponible
  // Si aún no se cargó, usamos solo el resumen (sin rubros ni proveedores)
  const detalle = datosObraResumen && gpDetalles?.[datosObraResumen.id];
  // datosObra = resumen + detalle si está disponible, sino solo resumen
  const datosObra = detalle ? {...datosObraResumen, ...detalle} : datosObraResumen;

  // ── Año actual para filtros ──
  const añoActual = new Date().getFullYear();
  const semanas = gpData?.semanasDisponibles || [];
  const ultimaSem = gpData?.ultimaSemana || '';

  // ── KPIs principales ──
  // El acumulado total es Grand Total (suma de todos los años). Si no está disponible
  // como columna, calculamos sumando años + total 2026 (sin traslapes con semanas/meses).
  const totalGP = datosObra
    ? (datosObra.grandTotal > 0
        ? datosObra.grandTotal
        : (datosObra.años ? Object.values(datosObra.años).reduce((t,v)=>t+v, 0) : 0)
          + (datosObra.total2026 || (datosObra.meses ? Object.values(datosObra.meses).reduce((t,v)=>t+v, 0) : 0)))
    : obra.gastoGP || 0;
  const totalGastoObra = totalGP + totalMaq + totalOtrosGastos;
  const pctPresupuesto = obra.presupuesto > 0 ? (totalGastoObra/obra.presupuesto)*100 : 0;

  // Gasto última semana y delta
  const gastoUltimaSem = datosObra?.semanas && ultimaSem ? (datosObra.semanas[ultimaSem] || 0) : 0;
  const semanasOrdenadas = semanas.slice();
  const idxUlt = semanasOrdenadas.indexOf(ultimaSem);
  const semAnterior = idxUlt > 0 ? semanasOrdenadas[idxUlt - 1] : null;
  const gastoSemAnterior = datosObra?.semanas && semAnterior ? (datosObra.semanas[semAnterior] || 0) : 0;
  const deltaUltSem = gastoUltimaSem - gastoSemAnterior;

  // Velocidad promedio últimas 4 semanas
  const ultimas4 = semanasOrdenadas.slice(-4);
  const sumUlt4 = datosObra?.semanas ? ultimas4.reduce((t,s)=>t+(datosObra.semanas[s]||0), 0) : 0;
  const velocidadProm = ultimas4.length > 0 ? sumUlt4/ultimas4.length : 0;

  // ── Análisis de proveedores ──
  const todosProveedores = datosObra?.proveedores || [];
  const proveedoresOrdenados = [...todosProveedores].sort((a,b)=>b.total-a.total);
  const top10Prov = proveedoresOrdenados.slice(0,10);
  const totalProveedores = todosProveedores.reduce((t,p)=>t+p.total, 0);
  const top3Pct = totalProveedores > 0
    ? top10Prov.slice(0,3).reduce((t,p)=>t+p.total, 0) / totalProveedores * 100
    : 0;
  const top10Pct = totalProveedores > 0
    ? top10Prov.reduce((t,p)=>t+p.total, 0) / totalProveedores * 100
    : 0;

  // Proveedores nuevos esta semana (aparecen en ultimaSem pero no en semanas anteriores)
  const nuevosEstaSem = ultimaSem
    ? todosProveedores.filter(p => {
        const semanasConGasto = Object.keys(p.semanas);
        return semanasConGasto.length === 1 && semanasConGasto[0] === ultimaSem;
      })
    : [];

  // Proveedores con mayor incremento esta semana vs anterior
  const proveedoresIncremento = todosProveedores
    .map(p => ({
      ...p,
      gastoUlt: p.semanas[ultimaSem] || 0,
      gastoAnt: semAnterior ? (p.semanas[semAnterior] || 0) : 0,
    }))
    .filter(p => p.gastoUlt > 0 && p.gastoAnt > 0)
    .map(p => ({...p, incrementoPct: ((p.gastoUlt - p.gastoAnt) / p.gastoAnt) * 100}))
    .filter(p => p.incrementoPct > 50)
    .sort((a,b)=>b.incrementoPct-a.incrementoPct)
    .slice(0, 5);

  // Proveedores inactivos: tienen gasto histórico pero no en últimas 4 semanas
  const proveedoresInactivos = ultimas4.length >= 4
    ? todosProveedores.filter(p => {
        const totalUlt4 = ultimas4.reduce((t,s)=>t+(p.semanas[s]||0), 0);
        return p.total > 0 && totalUlt4 === 0;
      }).sort((a,b)=>b.total-a.total).slice(0, 10)
    : [];

  // ── Análisis de rubros ──
  // Igual que la obra: usar grandTotal del rubro si existe, fallback a años+total2026
  const rubrosArr = datosObra && datosObra.rubros ? Object.values(datosObra.rubros) : [];
  const rubrosOrdenados = rubrosArr.map(r => ({
    ...r,
    total: r.grandTotal > 0
      ? r.grandTotal
      : Object.values(r.años||{}).reduce((t,v)=>t+v, 0)
        + (r.total2026 || Object.values(r.meses||{}).reduce((t,v)=>t+v, 0)),
  })).sort((a,b)=>b.total-a.total);
  const totalRubros = rubrosOrdenados.reduce((t,r)=>t+r.total, 0);

  // Colores por rubro (por orden, recicla la paleta)
  const RUBRO_COLORS = [C.blue, C.green, C.purple, C.orange, C.yellow, C.red, C.pink, C.indigo, C.caliza];
  const colorRubro = (i) => RUBRO_COLORS[i % RUBRO_COLORS.length];

  // ── Anomalías y proyección ──
  const gastoMaxHistorico = Math.max(...(datosObra && datosObra.semanas ? Object.values(datosObra.semanas) : [0]));
  const gastoPromedioSem = semanas.length > 0
    ? Object.values(datosObra?.semanas || {}).reduce((t,v)=>t+v,0) / semanas.length
    : 0;
  const semanasAnomalas = datosObra?.semanas
    ? semanasOrdenadas.filter(s => (datosObra.semanas[s]||0) > gastoPromedioSem * 2 && (datosObra.semanas[s]||0) > 0)
    : [];

  // Proyección: a velocidad actual, ¿cuándo se agota el presupuesto?
  const presupuestoRestante = Math.max(obra.presupuesto - totalGastoObra, 0);
  const semanasParaAgotar = velocidadProm > 0 ? Math.ceil(presupuestoRestante / velocidadProm) : null;

  // ── Alertas automáticas ──
  const alertas = [];
  if (top3Pct > 55) alertas.push({color:C.yellow, texto:`Top 3 proveedores concentran ${NUM(top3Pct,1)}% del gasto`, sub:"Considera diversificar"});
  if (gastoUltimaSem > gastoPromedioSem * 2 && gastoPromedioSem > 0) alertas.push({color:C.red, texto:`Gasto de última semana ${NUM(gastoUltimaSem/gastoPromedioSem,1)}x el promedio histórico`, sub:`${MXN(gastoUltimaSem)} vs ${MXN(gastoPromedioSem)} promedio`});
  if (proveedoresInactivos.length > 0) alertas.push({color:C.yellow, texto:`${proveedoresInactivos.length} proveedor(es) activos sin facturación en 4+ semanas`, sub:"Posibles ahorros o trabajos detenidos"});
  if (proveedoresIncremento.length > 0) alertas.push({color:C.yellow, texto:`${proveedoresIncremento.length} proveedor(es) con incremento >50% esta semana`, sub:"Verifica si es esperado"});

  // ── Render ──
  return <div style={{display:"flex",flexDirection:"column",gap:10}}>

    {/* MINI-DASHBOARD: 4 KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
      <Kpi label="Gasto acumulado" value={MXN(totalGastoObra)}
        sub={`GP + maquinaria${totalOtrosGastos>0?` + otros (${MXN(totalOtrosGastos)})`:""}`}
        color={C.red} size={12}/>
      <Kpi label="Última semana" value={MXN(gastoUltimaSem)}
        sub={`${deltaUltSem>=0?"+":""}${MXN(deltaUltSem)} vs sem ant.`}
        color={deltaUltSem > gastoPromedioSem ? C.red : C.caliza} size={12}/>
      <Kpi label="Velocidad prom." value={MXN(velocidadProm)} sub="últimas 4 semanas" color={C.purple} size={12}/>
      <Kpi label="% presupuesto" value={`${NUM(pctPresupuesto,1)}%`}
        sub={semanasParaAgotar ? `agota en ~${semanasParaAgotar} sem` : "consumido"}
        color={pctPresupuesto > 85 ? C.red : pctPresupuesto > 60 ? C.yellow : C.green}/>
    </div>

    {/* ALERTAS */}
    {alertas.length > 0 && (
      <Card accent={alertas.some(a=>a.color===C.red)?C.red:C.yellow}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:11,fontWeight:700,color:C.caliza,letterSpacing:"0.04em"}}>ALERTAS DE GASTO</span>
          <Bdg color={alertas.some(a=>a.color===C.red)?C.red:C.yellow} small>{alertas.length}</Bdg>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {alertas.map((a,i)=>(
            <div key={i} style={{background:C.bg,borderRadius:6,padding:"7px 11px",
              borderLeft:`3px solid ${a.color}`}}>
              <div style={{fontSize:10,fontWeight:600,color:C.textPri}}>{a.texto}</div>
              {a.sub && <div style={{fontSize:9,color:C.textMut,marginTop:2}}>{a.sub}</div>}
            </div>
          ))}
        </div>
      </Card>
    )}

    {/* Estado del Sheet GP + botón refrescar — visible siempre */}
    <Card style={{padding:"8px 14px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:10,color:C.textMut,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>Sheet GP Construct</div>
          {gpLoading && <div style={{fontSize:10,color:C.blueDk,marginTop:2}}>Cargando datos del Sheet…</div>}
          {!gpLoading && gpData?.obras && Object.keys(gpData.obras).length > 0 && (
            <div style={{fontSize:10,color:C.textSec,marginTop:2}}>
              {Object.keys(gpData.obras).length} obras · {gpData.semanasDisponibles?.length||0} semanas detectadas
              {gpUltActualiz && <span style={{color:C.textMut}}> · {gpUltActualiz}</span>}
            </div>
          )}
          {!gpLoading && (!gpData?.obras || Object.keys(gpData.obras).length === 0) && (
            <div style={{fontSize:10,color:C.redDk,marginTop:2}}>Sheet no cargado</div>
          )}
          {gpError && <div style={{fontSize:9,color:C.yellow,marginTop:2}}>{gpError}</div>}
        </div>
        {onRefreshGP && (
          <button onClick={()=>onRefreshGP(true)} disabled={gpLoading}
            style={{background:C.caliza,border:"none",borderRadius:6,padding:"5px 12px",
              fontSize:10,fontWeight:600,color:C.bg,cursor:gpLoading?"not-allowed":"pointer",
              opacity:gpLoading?0.5:1,whiteSpace:"nowrap"}}>
            {gpLoading?"…":"Refrescar Sheet"}
          </button>
        )}
      </div>
    </Card>

    {/* Si no hay datos de GP, mostrar mensaje + selector manual */}
    {!datosObra && (
      <Card>
        <div style={{padding:14}}>
          <div style={{fontSize:13,fontWeight:600,color:C.caliza,marginBottom:6,textAlign:"center"}}>
            {(!gpData?.obras || Object.keys(gpData.obras).length === 0)
              ? (gpLoading ? "Cargando Sheet de GP…" : "Sheet de GP no disponible")
              : "Esta obra no está mapeada al Sheet"}
          </div>
          <div style={{fontSize:10,color:C.textSec,textAlign:"center",marginBottom:12}}>
            {(!gpData?.obras || Object.keys(gpData.obras).length === 0)
              ? (gpLoading
                ? "Espera unos segundos a que termine la descarga."
                : "Posibles causas: el proxy CORS está bloqueado, sin internet o el Sheet no está público. Intenta el botón Refrescar.")
              : "El sistema buscó por nombre y por ID pero no hay coincidencia automática."}
          </div>

          {/* Selector manual de obra GP */}
          {gpData?.obras && Object.keys(gpData.obras).length > 0 && (
            <div style={{background:C.bg,borderRadius:8,padding:12}}>
              <div style={{fontSize:10,color:C.textMut,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                Selecciona la obra correspondiente en GP Construct:
              </div>
              <Sel value={obra.gpId||""}
                onChange={async (e) => {
                  const nuevoId = e.target.value;
                  const upd = {...obra, gpId: nuevoId};
                  setObra(upd);
                  await fsSet(`obras/${obra.id}/config/info`, {gpId: nuevoId});
                  await fsSet(`obras/${obra.id}`, {gpId: nuevoId});
                }}>
                <option value="">— Selecciona una obra —</option>
                {Object.values(gpData.obras)
                  .sort((a,b)=>a.id.localeCompare(b.id))
                  .map(o => (
                    <option key={o.id} value={o.id}>{o.id} · {o.nombre.replace(/^\d{4}\s*/,'')}</option>
                  ))}
              </Sel>
              <div style={{fontSize:9,color:C.textMut,marginTop:6}}>
                Esta selección se guarda y se usa en futuras cargas.
              </div>
            </div>
          )}
        </div>
      </Card>
    )}

    {datosObra && <>
      {/* Sub-tabs */}
      <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",
        background:C.surface,padding:"6px 4px",borderRadius:8,border:`0.5px solid ${C.border}`}}>
        {[["resumen","Resumen"],["proveedores","Proveedores"],["rubros","Rubros"],["semanas","Tendencia semanal"],["otros","Otros gastos"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setSubtab(id)} style={{flex:"0 0 auto",padding:"7px 14px",
            fontSize:11,borderRadius:6,background:subtab===id?C.caliza:"transparent",
            border:"none",color:subtab===id?C.bg:C.textSec,
            fontWeight:subtab===id?700:400,whiteSpace:"nowrap",cursor:"pointer"}}>{lbl}</button>
        ))}
      </div>

      {/* RESUMEN */}
      {subtab==="resumen" && (
        <>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <Tit>Desglose por rubro</Tit>
              <span style={{fontSize:9,color:C.textMut}}>{rubrosOrdenados.length} rubros · al {ultimaSem}</span>
            </div>
            {rubrosOrdenados.map((r,i)=>{
              const pctR = totalRubros > 0 ? r.total/totalRubros*100 : 0;
              const col = colorRubro(i);
              return <div key={r.id} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:col,flexShrink:0}}/>
                    <span style={{fontSize:9,color:C.textMut,fontWeight:600}}>{r.id}</span>
                    <span style={{fontSize:11,color:C.textPri,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nombreCorto}</span>
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
                    <span style={{fontSize:9,color:C.textMut}}>{NUM(pctR,1)}%</span>
                    <span style={{fontSize:12,fontWeight:600,color:col}}>{MXN(r.total)}</span>
                  </div>
                </div>
                <Bar pct={pctR} color={col}/>
              </div>;
            })}
            <div style={{marginTop:8,paddingTop:8,borderTop:`0.5px solid ${C.border}`,
              display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:C.textMut}}>TOTAL GP CONSTRUCT</span>
              <span style={{fontSize:14,fontWeight:700,color:C.textPri}}>{MXN(totalGP)}</span>
            </div>
            {totalMaq > 0 && (
              <div style={{marginTop:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:10,color:C.textMut}}>+ Maquinaria propia</span>
                <span style={{fontSize:12,fontWeight:600,color:C.orange}}>{MXN(totalMaq)}</span>
              </div>
            )}
            {totalOtrosGastos > 0 && (
              <div style={{marginTop:4,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
                onClick={()=>setSubtab("otros")} title="Ver otros gastos">
                <span style={{fontSize:10,color:C.textMut}}>+ Otros gastos ({otrosGastos.length})</span>
                <span style={{fontSize:12,fontWeight:600,color:C.yellowDk}}>{MXN(totalOtrosGastos)}</span>
              </div>
            )}
            <div style={{marginTop:6,paddingTop:6,borderTop:`0.5px solid ${C.border}`,
              display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:C.textPri,fontWeight:600}}>GASTO TOTAL OBRA</span>
              <span style={{fontSize:14,fontWeight:700,color:C.red}}>{MXN(totalGastoObra)}</span>
            </div>
          </Card>

          {/* Top 5 proveedores compact preview */}
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <Tit>Top 5 proveedores</Tit>
              <button onClick={()=>setSubtab("proveedores")} style={{background:"none",border:"none",
                fontSize:10,color:C.blueDk,cursor:"pointer",fontWeight:600}}>
                Ver todos ›
              </button>
            </div>
            {top10Prov.slice(0,5).map((p,i)=>{
              const pctP = totalProveedores > 0 ? p.total/totalProveedores*100 : 0;
              return <div key={p.nombre} style={{display:"grid",gridTemplateColumns:"24px 1fr auto auto",gap:8,
                padding:"7px 0",borderBottom:i<4?`0.5px solid ${C.border}`:"none",alignItems:"center"}}>
                <div style={{fontSize:9,color:C.textMut,fontWeight:700}}>#{i+1}</div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:600,color:C.caliza,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                  <div style={{fontSize:9,color:C.textMut}}>{p.rubroNombre}</div>
                </div>
                <div style={{fontSize:9,color:C.textMut,whiteSpace:"nowrap"}}>{NUM(pctP,1)}%</div>
                <div style={{fontSize:11,fontWeight:600,color:C.caliza,textAlign:"right",whiteSpace:"nowrap"}}>{MXN(p.total)}</div>
              </div>;
            })}
          </Card>
        </>
      )}

      {/* PROVEEDORES */}
      {subtab==="proveedores" && (
        <>
          <Card>
            <Tit>Concentración de proveedores</Tit>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:8}}>
              <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${top3Pct>55?C.red:top3Pct>40?C.yellow:C.green}`}}>
                <div style={{fontSize:9,color:C.textMut}}>Top 3</div>
                <div style={{fontSize:14,fontWeight:700,color:top3Pct>55?C.redDk:top3Pct>40?C.yellowDk:C.greenDk}}>{NUM(top3Pct,1)}%</div>
              </div>
              <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.purple}`}}>
                <div style={{fontSize:9,color:C.textMut}}>Top 10</div>
                <div style={{fontSize:14,fontWeight:700,color:C.purpleDk}}>{NUM(top10Pct,1)}%</div>
              </div>
              <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.caliza}`}}>
                <div style={{fontSize:9,color:C.textMut}}>Total únicos</div>
                <div style={{fontSize:14,fontWeight:700,color:C.caliza}}>{todosProveedores.length}</div>
              </div>
            </div>
          </Card>

          <Card>
            <Tit>Top 10 proveedores por monto</Tit>
            <div style={{display:"grid",gridTemplateColumns:"30px 1fr 1.5fr 70px 100px",gap:6,
              padding:"5px 10px",fontSize:9,color:C.textMut,fontWeight:700,textTransform:"uppercase"}}>
              <div>#</div><div>Proveedor</div><div>Rubro</div><div style={{textAlign:"right"}}>%</div><div style={{textAlign:"right"}}>Monto</div>
            </div>
            {top10Prov.map((p,i)=>{
              const pctP = totalProveedores > 0 ? p.total/totalProveedores*100 : 0;
              return <div key={p.nombre} style={{display:"grid",gridTemplateColumns:"30px 1fr 1.5fr 70px 100px",gap:6,
                padding:"8px 10px",marginBottom:4,background:C.bg,borderRadius:6,alignItems:"center",
                borderLeft:`3px solid ${i<3?C.caliza:C.border}`}}>
                <div style={{fontSize:11,fontWeight:700,color:i<3?C.caliza:C.textMut}}>{i+1}</div>
                <div style={{fontSize:11,fontWeight:600,color:C.caliza,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                <div style={{fontSize:10,color:C.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.rubroNombre}</div>
                <div style={{fontSize:10,color:C.textMut,textAlign:"right"}}>{NUM(pctP,1)}%</div>
                <div style={{fontSize:11,fontWeight:600,color:C.caliza,textAlign:"right"}}>{MXN(p.total)}</div>
              </div>;
            })}
          </Card>

          {/* Nuevos esta semana */}
          {nuevosEstaSem.length > 0 && (
            <Card accent={C.blue}>
              <Tit>Proveedores nuevos en {ultimaSem}</Tit>
              <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>
                Aparecen por primera vez en esta semana
              </div>
              {nuevosEstaSem.map(p => (
                <div key={p.nombre} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"6px 10px",marginBottom:4,background:C.bg,borderRadius:6}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:C.caliza,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                    <div style={{fontSize:9,color:C.textMut}}>{p.rubroNombre}</div>
                  </div>
                  <div style={{fontSize:11,fontWeight:600,color:C.blueDk}}>{MXN(p.total)}</div>
                </div>
              ))}
            </Card>
          )}

          {/* Incremento súbito */}
          {proveedoresIncremento.length > 0 && (
            <Card accent={C.yellow}>
              <Tit>Mayor incremento esta semana</Tit>
              <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>
                Proveedores que facturaron >50% más que la semana anterior
              </div>
              {proveedoresIncremento.map(p => (
                <div key={p.nombre} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:8,
                  padding:"7px 10px",marginBottom:4,background:C.bg,borderRadius:6,alignItems:"center"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:C.caliza,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                    <div style={{fontSize:9,color:C.textMut}}>{p.rubroNombre}</div>
                  </div>
                  <div style={{fontSize:9,color:C.textMut,textAlign:"right"}}>
                    <div>{MXN(p.gastoAnt)}</div>
                    <div>→ {MXN(p.gastoUlt)}</div>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:C.yellowDk,textAlign:"right"}}>+{NUM(p.incrementoPct,0)}%</div>
                </div>
              ))}
            </Card>
          )}

          {/* Inactivos */}
          {proveedoresInactivos.length > 0 && (
            <Card accent={C.textMut}>
              <Tit>Proveedores inactivos</Tit>
              <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>
                Sin facturación en las últimas 4 semanas (tienen gasto histórico)
              </div>
              {proveedoresInactivos.slice(0,5).map(p => (
                <div key={p.nombre} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"6px 10px",marginBottom:4,background:C.bg,borderRadius:6,opacity:0.75}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:C.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                    <div style={{fontSize:9,color:C.textMut}}>{p.rubroNombre}</div>
                  </div>
                  <div style={{fontSize:10,color:C.textMut}}>Total: {MXN(p.total)}</div>
                </div>
              ))}
              {proveedoresInactivos.length > 5 && (
                <div style={{fontSize:9,color:C.textMut,textAlign:"center",marginTop:6}}>
                  + {proveedoresInactivos.length - 5} más
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* RUBROS */}
      {subtab==="rubros" && (
        <Card>
          <Tit>Análisis detallado por rubro</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:10}}>
            Tendencia de gasto por rubro a lo largo de las semanas disponibles
          </div>
          {rubrosOrdenados.map((r,ri) => {
            const col = colorRubro(ri);
            const valoresSem = semanasOrdenadas.map(s => r.semanas[s] || 0);
            const maxV = Math.max(...valoresSem, 1);
            const provDelRubro = (r.proveedores || []).sort((a,b)=>b.total-a.total).slice(0,3);
            return <div key={r.id} style={{marginBottom:18,paddingBottom:14,borderBottom:`0.5px solid ${C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:col,flexShrink:0}}/>
                    <span style={{fontSize:9,color:C.textMut,fontWeight:600}}>{r.id}</span>
                    <span style={{fontSize:12,fontWeight:700,color:C.caliza}}>{r.nombreCorto}</span>
                  </div>
                  <div style={{fontSize:9,color:C.textMut,marginTop:3}}>
                    {(r.proveedores||[]).length} proveedor(es) · {NUM(totalRubros > 0 ? r.total/totalRubros*100 : 0, 1)}% del gasto GP
                  </div>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:col,textAlign:"right"}}>{MXN(r.total)}</div>
              </div>
              {/* Mini sparkline */}
              <div style={{display:"flex",alignItems:"flex-end",gap:3,height:30,marginBottom:6}}>
                {valoresSem.map((v,i) => (
                  <div key={i} title={`${semanasOrdenadas[i]}: ${MXN(v)}`}
                    style={{flex:1,background:v>0?col:"transparent",
                      height:`${Math.max((v/maxV)*30, v>0?2:0)}px`,
                      borderRadius:2,opacity:i===semanasOrdenadas.length-1?1:0.5}}/>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textMut,marginBottom:6}}>
                {semanasOrdenadas.length > 0 && <><span>{semanasOrdenadas[0]}</span><span>{semanasOrdenadas[semanasOrdenadas.length-1]}</span></>}
              </div>
              {/* Top 3 proveedores del rubro */}
              {provDelRubro.length > 0 && (
                <div style={{marginTop:6}}>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Top proveedores del rubro:</div>
                  {provDelRubro.map(p => (
                    <div key={p.nombre} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                      fontSize:10,padding:"3px 8px",background:C.bg,borderRadius:4,marginBottom:2}}>
                      <span style={{color:C.textSec,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0,marginRight:8}}>{p.nombre}</span>
                      <span style={{color:C.caliza,fontWeight:600,flexShrink:0}}>{MXN(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>;
          })}
        </Card>
      )}

      {/* SEMANAS */}
      {subtab==="semanas" && (
        <>
          <Card>
            <Tit>Tendencia semanal de gasto</Tit>
            <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:10}}>
              {semanasOrdenadas.length} semanas registradas · Promedio: {MXN(gastoPromedioSem)}/sem
            </div>
            {semanasOrdenadas.map(s => {
              const v = (datosObra?.semanas && datosObra.semanas[s]) || 0;
              const pct = gastoMaxHistorico > 0 ? (v/gastoMaxHistorico)*100 : 0;
              const esAnomala = semanasAnomalas.includes(s);
              const col = esAnomala ? C.red : s===ultimaSem ? C.caliza : C.textMut;
              return <div key={s} style={{marginBottom:7}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
                  <span style={{color:col,fontWeight:s===ultimaSem?700:400}}>
                    {s} {esAnomala && <span style={{color:C.red,fontSize:9}}>· anomalía</span>}
                  </span>
                  <span style={{fontWeight:600,color:col}}>{MXN(v)}</span>
                </div>
                <Bar pct={pct} color={col}/>
              </div>;
            })}
          </Card>

          <Card accent={semanasParaAgotar && semanasParaAgotar < 8 ? C.red : C.blue}>
            <Tit>Proyección de gasto</Tit>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
              <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.blueDk}`}}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>Velocidad última 4 sem</div>
                <div style={{fontSize:14,fontWeight:700,color:C.blueDk}}>{MXN(velocidadProm)}/sem</div>
              </div>
              <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.greenDk}`}}>
                <div style={{fontSize:9,color:C.textMut,marginBottom:2}}>Por consumir</div>
                <div style={{fontSize:14,fontWeight:700,color:C.greenDk}}>{MXN(presupuestoRestante)}</div>
              </div>
            </div>
            {semanasParaAgotar !== null && (
              <div style={{marginTop:10,padding:"10px 12px",background:semanasParaAgotar<8?`${C.red}15`:`${C.blue}15`,
                borderRadius:6,fontSize:10,color:semanasParaAgotar<8?C.redDk:C.blueDk}}>
                A la velocidad actual el presupuesto se agota en aproximadamente <b>{semanasParaAgotar} semanas</b>
                {obra.fin && (() => {
                  const semsRestPlazo = Math.max(Math.floor((new Date(obra.fin) - new Date())/(1000*60*60*24*7)), 0);
                  return <span> (quedan {semsRestPlazo} semanas de plazo contractual).</span>;
                })()}
              </div>
            )}
          </Card>
        </>
      )}

      {/* OTROS GASTOS — partidas manuales que se suman a GP */}
      {subtab==="otros" && (
        <>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <Tit>Otros gastos (fuera de GP Construct)</Tit>
                <div style={{fontSize:10,color:C.textMut,marginTop:2,lineHeight:1.4}}>
                  Para conceptos que no aparecen en el Sheet de GP (pagos directos, conciliaciones, ajustes).
                  Se suman al total de gastos de esta obra.
                </div>
              </div>
              <Kpi label="Total" value={MXN(totalOtrosGastos)} sub={`${otrosGastos.length} partidas`} color={C.yellow} size={13}/>
            </div>
          </Card>
          <Card>
            {!otrosLoaded ? (
              <div style={{padding:20,textAlign:"center",fontSize:11,color:C.textMut}}>Cargando…</div>
            ) : otrosGastos.length===0 ? (
              <div style={{padding:20,textAlign:"center"}}>
                <div style={{fontSize:11,color:C.textSec,marginBottom:10}}>No hay gastos extra registrados.</div>
                {puedeEditarOtros && <SecBtn onClick={agregarOtroGasto}>+ Agregar primer gasto</SecBtn>}
              </div>
            ) : (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${C.border}`,color:C.textMut,fontSize:9,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                      <th style={{textAlign:"left",padding:"6px 8px",width:"110px"}}>Fecha</th>
                      <th style={{textAlign:"left",padding:"6px 8px"}}>Concepto</th>
                      <th style={{textAlign:"right",padding:"6px 8px",width:"130px"}}>Importe</th>
                      <th style={{textAlign:"left",padding:"6px 8px"}}>Notas</th>
                      {puedeEditarOtros && <th style={{width:"40px"}}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {otrosGastos.map(g=>(
                      <tr key={g.id} style={{borderBottom:`1px solid ${C.bg}`}}>
                        <td style={{padding:"4px 8px"}}>
                          {puedeEditarOtros ? (
                            <input type="date" value={g.fecha||""}
                              onChange={e=>actualizarOtroGasto(g.id,"fecha",e.target.value)}
                              onBlur={commitOtroGasto}
                              style={{width:"100%",fontSize:10,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4}}/>
                          ) : g.fecha}
                        </td>
                        <td style={{padding:"4px 8px"}}>
                          {puedeEditarOtros ? (
                            <input type="text" value={g.concepto||""}
                              onChange={e=>actualizarOtroGasto(g.id,"concepto",e.target.value)}
                              onBlur={commitOtroGasto}
                              placeholder="Ej. pago directo proveedor X"
                              style={{width:"100%",fontSize:11,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4}}/>
                          ) : g.concepto}
                        </td>
                        <td style={{padding:"4px 8px",textAlign:"right"}}>
                          {puedeEditarOtros ? (
                            <input type="number" value={g.importe||0} step="0.01"
                              onChange={e=>actualizarOtroGasto(g.id,"importe",parseFloat(e.target.value)||0)}
                              onBlur={commitOtroGasto}
                              style={{width:"100%",fontSize:11,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4,textAlign:"right"}}/>
                          ) : <span style={{fontWeight:600}}>{MXN(g.importe)}</span>}
                        </td>
                        <td style={{padding:"4px 8px"}}>
                          {puedeEditarOtros ? (
                            <input type="text" value={g.notas||""}
                              onChange={e=>actualizarOtroGasto(g.id,"notas",e.target.value)}
                              onBlur={commitOtroGasto}
                              style={{width:"100%",fontSize:10,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4,color:C.textMut}}/>
                          ) : g.notas}
                        </td>
                        {puedeEditarOtros && (
                          <td style={{padding:"4px 8px",textAlign:"center"}}>
                            <button onClick={()=>eliminarOtroGasto(g.id)}
                              style={{background:"none",border:"none",color:C.red,fontSize:14,cursor:"pointer",padding:"2px 6px"}}
                              title="Eliminar">×</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr style={{borderTop:`2px solid ${C.border}`,background:C.bg}}>
                      <td colSpan={2} style={{padding:"8px",fontSize:11,fontWeight:600,color:C.textPri}}>Total</td>
                      <td style={{padding:"8px",textAlign:"right",fontSize:12,fontWeight:700,color:C.caliza}}>{MXN(totalOtrosGastos)}</td>
                      <td colSpan={puedeEditarOtros?2:1}></td>
                    </tr>
                  </tbody>
                </table>
                {puedeEditarOtros && (
                  <div style={{marginTop:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <SecBtn onClick={agregarOtroGasto} disabled={otrosSaving}>+ Agregar gasto</SecBtn>
                    {otrosSaving && <span style={{fontSize:10,color:C.textMut}}>Guardando…</span>}
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </>}

    {/* Panel diagnóstico solo para admin_sistema (Luis Mayo) */}
    {rol === 'admin_sistema' && gpData && (
      <PanelDiagnosticoGP gpData={gpData} obra={obra} datosObra={datosObra}/>
    )}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL DE DIAGNÓSTICO DE GP CONSTRUCT — solo admin_sistema
// ════════════════════════════════════════════════════════════════════════════
function PanelDiagnosticoGP({gpData, obra, datosObra}){
  const [abierto, setAbierto] = useState(false);
  const colsCount = Object.keys(gpData?.colMap || {}).length;
  const obrasDetectadas = gpData?.totalObras || 0;
  const semanasDet = gpData?.semanasDisponibles?.length || 0;
  const mesesDet = gpData?.mesesDisponibles?.length || 0;
  return <Card style={{marginTop:14, background:'#fafafa', border:`0.5px dashed ${C.borderM}`}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
      onClick={()=>setAbierto(!abierto)}>
      <div>
        <Tit>Diagnóstico parser GP Construct</Tit>
        <div style={{fontSize:9,color:C.textMut,marginTop:-4}}>
          Visible solo para Administrador de Sistema · {colsCount} columnas detectadas · {obrasDetectadas} obras
        </div>
      </div>
      <span style={{fontSize:14,color:C.textMut}}>{abierto?'▾':'▸'}</span>
    </div>
    {abierto && (
      <div style={{marginTop:12,padding:12,background:C.surface,borderRadius:6,fontSize:10}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8,marginBottom:14}}>
          <div><b style={{color:C.textPri}}>Obras detectadas:</b> {obrasDetectadas}</div>
          <div><b style={{color:C.textPri}}>Semanas:</b> {semanasDet}</div>
          <div><b style={{color:C.textPri}}>Meses:</b> {mesesDet}</div>
          <div><b style={{color:C.textPri}}>Última semana:</b> {gpData?.ultimaSemana||'—'}</div>
          <div><b style={{color:C.textPri}}>Último mes:</b> {gpData?.ultimoMes||'—'}</div>
        </div>

        <div style={{fontSize:9,fontWeight:700,color:C.textPri,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>
          Columnas detectadas
        </div>
        <div style={{maxHeight:180,overflow:"auto",border:`0.5px solid ${C.border}`,borderRadius:6,padding:8}}>
          {Object.entries(gpData?.colMap||{}).sort((a,b)=>a[1]-b[1]).map(([k,v])=>{
            let tipo='', color=C.textMut;
            if(k.startsWith('y_')) { tipo='Año'; color=C.purple; }
            else if(k.startsWith('m_')) { tipo='Mes 2026'; color=C.blue; }
            else if(k.startsWith('w_')) { tipo='Semana'; color=C.green; }
            else if(k==='total_2026') { tipo='Total 2026'; color=C.orange; }
            else if(k==='grand_total') { tipo='Grand Total'; color=C.red; }
            else if(k==='pct') { tipo='%'; color=C.textMut; }
            return <div key={k} style={{display:"flex",justifyContent:"space-between",
              fontSize:9,padding:"3px 6px",borderBottom:`0.5px dashed ${C.border}`}}>
              <span style={{fontFamily:"monospace",color:C.textSec}}>col {v}</span>
              <span style={{color:color,fontWeight:600}}>{tipo}</span>
              <span style={{fontFamily:"monospace",color:C.textMut}}>{k}</span>
            </div>;
          })}
        </div>

        {datosObra && (
          <div style={{marginTop:14,padding:10,background:C.bg,borderRadius:6}}>
            <div style={{fontSize:9,fontWeight:700,color:C.textPri,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>
              Match con obra actual
            </div>
            <div style={{fontSize:10,color:C.textSec}}>
              <div>Obra CAMPO: <b>{obra.id} · {obra.nombre}</b></div>
              <div>Encontrada en GP: <b style={{color:C.greenDk}}>{datosObra.id} · {datosObra.nombre}</b></div>
              <div style={{marginTop:4}}>
                Grand Total: <b>{MXN(datosObra.grandTotal||0)}</b> · Rubros: <b>{Object.keys(datosObra.rubros||{}).length}</b> · Proveedores: <b>{(datosObra.proveedores||[]).length}</b>
              </div>
            </div>
          </div>
        )}

        {!datosObra && (
          <div style={{marginTop:14,padding:10,background:`${C.red}10`,borderRadius:6,fontSize:10,color:C.redDk}}>
            ⚠ Esta obra no fue encontrada en el Sheet. Si esperabas verla, verifica el código de 4 dígitos.
          </div>
        )}

        <div style={{marginTop:12,fontSize:9,color:C.textMut}}>
          Si el formato del Sheet cambia y dejan de detectarse columnas, este panel ayudará a diagnosticar el problema.
        </div>
      </div>
    )}
  </Card>;
}

// ── ESTIMACIONES ───────────────────────────────────────────────────────────
function Estimaciones({obra,setObra,estimaciones,setEstimaciones,rol,usuario}){
  const[saved,setSaved]=useState(false);
  const editar=can(rol,"estimaciones","editar");
  // Snapshot del estado guardado para detectar cambios en el próximo save
  const[snapshotGuardado,setSnapshotGuardado]=useState(null);
  useEffect(() => {
    // Al cargar el componente, guardar el snapshot inicial
    if (snapshotGuardado === null && estimaciones.length > 0) {
      setSnapshotGuardado(JSON.stringify(estimaciones.map(e=>({no:e.no, estatus:e.estatus, monto:e.monto}))));
    }
  }, [estimaciones, snapshotGuardado]);

  // Función que dispara notif al guardar
  const dispararNotifsCambios = async (nuevas) => {
    if (!snapshotGuardado) return;
    try {
      const ant = JSON.parse(snapshotGuardado);
      const antMap = Object.fromEntries(ant.map(e=>[e.no, e]));
      const link = { tab: 'operacion', subTab: 'estimaciones', obraId: obra.id };
      const creadaPor = usuario?.correo || 'sistema';
      for (const e of nuevas) {
        const prev = antMap[e.no];
        if (!prev) {
          // Nueva estimación
          await notifARoles(['director_general','director_operaciones','admin_sistema'], {
            categoria: 'financiero', tipo: 'estim_creada',
            titulo: `Nueva estimación EST-0${e.no} · ${obra.nombre||obra.id}`,
            mensaje: `${MXN(e.monto)} en estatus ${e.estatus}`,
            link, creadaPor,
          });
        } else if (prev.estatus !== e.estatus) {
          // Cambio de estatus
          if (e.estatus === 'Facturada') {
            await notifARoles(['director_general','director_operaciones','admin_sistema'], {
              categoria: 'financiero', tipo: 'estim_facturada',
              titulo: `EST-0${e.no} facturada · ${obra.nombre||obra.id}`,
              mensaje: `${MXN(e.monto)} · ${obra.diasPago||30} días para vencer cobro`,
              link, creadaPor,
            });
          } else if (e.estatus === 'Pagada') {
            await notifARoles(['director_general','director_operaciones','admin_sistema'], {
              categoria: 'financiero', tipo: 'estim_pagada',
              titulo: `EST-0${e.no} cobrada · ${obra.nombre||obra.id}`,
              mensaje: `${MXN(e.monto)} recibidos del cliente`,
              link, creadaPor,
            });
          } else if (e.estatus === 'Aprobada') {
            await notifARoles(['director_general','director_operaciones','admin_sistema'], {
              categoria: 'financiero', tipo: 'estim_aprobada',
              titulo: `EST-0${e.no} aprobada · ${obra.nombre||obra.id}`,
              mensaje: `${MXN(e.monto)} lista para facturar`,
              link, creadaPor,
            });
          }
        }
      }
      // Actualizar snapshot
      setSnapshotGuardado(JSON.stringify(nuevas.map(e=>({no:e.no, estatus:e.estatus, monto:e.monto}))));
    } catch(err) { console.error('dispararNotifsCambios', err); }
  };
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
        {editar&&<button onClick={async ()=>{
          try{
            await fsSetA(`obras/${obra.id}/config/estimaciones`, {data:estimaciones},
              { modulo:"estimaciones", entidad:`${estimaciones.length} estimaciones`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
            await fsSetA(`obras/${obra.id}/config/parametros`,
              {pctAnticipo:obra.pctAnticipo,pctFondoGar:obra.pctFondoGar,pctRetencion:obra.pctRetencion||0},
              { modulo:"contrato", entidad:"parámetros de estimación", obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
            // Disparar notif por cambios detectados
            dispararNotifsCambios(estimaciones);
            setSaved(true); setTimeout(()=>setSaved(false),2500);
          }catch(e){alert("Error al guardar");}
        }} style={{background:saved?C.green:C.caliza,border:"none",borderRadius:6,
          padding:"5px 14px",fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer",
          transition:"background .3s",display:"flex",alignItems:"center",gap:5}}>
          {saved?"Guardado":"Guardar cambios"}
        </button>}
      </div>
      </div>
      {estimaciones.filter(e => e.monto > 0 || (e.periodo && e.periodo.trim())).length === 0 && (
        <div style={{padding:"24px 16px",textAlign:"center",background:C.bg,borderRadius:8,marginTop:8}}>
          <div style={{fontSize:12,fontWeight:600,color:C.caliza,marginBottom:6}}>
            Sin estimaciones registradas
          </div>
          <div style={{fontSize:10,color:C.textSec,maxWidth:380,margin:"0 auto",lineHeight:1.5}}>
            {editar
              ? 'Click "+ Nueva estimación" arriba para registrar la primera. Captura el monto (SIN IVA), período, estatus y fecha de facturación cuando aplique.'
              : 'Aún no hay estimaciones registradas en esta obra.'}
          </div>
        </div>
      )}
      {estimaciones.map((e,i)=>{
        const c=cE(e); const ecol=EST_COL[e.estatus]||C.yellow;
        // Calcular días de atraso si la estimación está Facturada y tiene fecha
        let pillAtraso = null;
        if(e.estatus==="Facturada" && e.fechaFact){
          const diasPago = obra.diasPago||30;
          const diasTrans = Math.floor((new Date() - new Date(e.fechaFact))/(1000*60*60*24));
          const diasAtraso = diasTrans - diasPago;
          if(diasAtraso > 0){
            pillAtraso = {color:C.red, texto:`${diasAtraso}d de atraso`, sub:`${diasTrans}d desde facturación vs plazo ${diasPago}d`};
          } else if(diasTrans >= diasPago - 7){
            pillAtraso = {color:C.yellow, texto:`${-diasAtraso}d para vencer`, sub:`${diasTrans}d desde facturación vs plazo ${diasPago}d`};
          } else {
            pillAtraso = {color:C.green, texto:`Dentro de plazo`, sub:`${diasTrans}d / ${diasPago}d de plazo`};
          }
        }
        return <div key={e.no} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,
          borderLeft:`3px solid ${pillAtraso?.color===C.red?C.red:ecol}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
              <span style={{fontSize:13,fontWeight:700,color:C.caliza,letterSpacing:"0.06em"}}>EST-0{e.no}</span>
              {pillAtraso && <Bdg color={pillAtraso.color} small>{pillAtraso.texto}</Bdg>}
            </div>
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
          {pillAtraso && <div style={{fontSize:9,color:C.textMut,marginTop:-4,marginBottom:8}}>{pillAtraso.sub}</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Monto bruto (SIN IVA)</div>
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
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Fecha facturación</div>
              {editar?<Inp type="date" value={e.fechaFact||""} style={{fontSize:11}}
                onChange={ev=>setEstimaciones(es=>es.map((x,j)=>j===i?{...x,fechaFact:ev.target.value}:x))}/>
              :<div style={{fontSize:12,color:C.textSec,padding:"5px 0"}}>{e.fechaFact||"—"}</div>}
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

  // Helper: extraer número desde celda (maneja $, comas, %, etc.)
  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const s = String(v).trim().replace(/[$,\s%]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  // Encontrar fila de headers buscando PALABRAS CLAVE típicas de presupuesto.
  // Antes buscaba "primera fila con ≥3 cols de texto" pero eso podía caer en
  // metadatos del Excel (logo, fecha, título). Ahora exigimos que la fila
  // contenga al menos 3 de las palabras: clave, descripción, unidad, cantidad,
  // precio, importe, partida...
  const PALABRAS_HEADER = [
    /^clave\b/i, /^c[oó]digo\b/i, /^id$/i, /^no\.?$/i,
    /descripci/i, /concepto/i, /partida/i,
    /^unidad\b/i, /^und?\b/i, /^u\.?\s*m\.?/i,
    /cantidad/i, /^cant\.?\b/i, /volumen/i, /^vol\.?\b/i,
    /precio/i, /^p\.?\s*u\.?\b/i, /unitar/i,
    /importe/i, /^total\b/i, /^monto\b/i, /^subtotal\b/i,
    /incidencia/i, /porcent/i,
  ];
  const contarPalabrasHeader = (fila) => fila.filter(c => {
    const s = String(c||'').trim();
    if (!s || s.length > 40) return false;
    return PALABRAS_HEADER.some(p => p.test(s));
  }).length;

  let headerRow = 0;
  let dataStart = 0;
  for (let i = 0; i < Math.min(filas.length, 30); i++) {
    if (contarPalabrasHeader(filas[i]) >= 3) {
      headerRow = i; dataStart = i + 1; break;
    }
  }
  // Caso especial: Opus suele tener 2 filas de header (ej: "Precio Unitario"
  // arriba, y debajo "Con Número | Con letra"). Si la fila siguiente al
  // header tiene texto en columnas donde el header está vacío, saltarla.
  if (dataStart > 0 && filas[dataStart]) {
    const subHeader = filas[dataStart];
    const subHeaderTienePalabras = subHeader.some(c => {
      const s = String(c||'').trim();
      return /^con\s+(n[uú]mero|letra)/i.test(s) || /^[a-z]+\s+/i.test(s) && s.length < 25;
    });
    // Si la fila tiene "Con Número" / "Con letra" claramente, es sub-header
    const tieneConNumLetra = subHeader.some(c => /^con\s+(n[uú]mero|letra)/i.test(String(c||'').trim()));
    if (tieneConNumLetra) {
      dataStart = dataStart + 1;
    }
  }
  // Fallback si no se encontró: usar la primera fila con ≥3 cols de texto
  if (dataStart === 0) {
    for (let i = 0; i < Math.min(filas.length, 20); i++) {
      const textCols = filas[i].filter(c => c && isNaN(Number(c)) && String(c).trim().length > 1).length;
      if (textCols >= 3) { headerRow = i; dataStart = i + 1; break; }
    }
  }

  const nCols = filas[0]?.length || 0;
  const headers = (filas[headerRow] || []).map(h => String(h || '').trim().toLowerCase());

  // Pistas por header — patrones comunes en Opus, Neodata, manual, etc.
  const headerMatch = (h, patterns) => patterns.some(p => p.test(h));
  const H_CLAVE    = [/clave/i, /c[oó]digo/i, /^id$/i, /^no\.?$/i];
  const H_DESC     = [/descripci[oó]n/i, /^concepto$/i, /^partida$/i];
  const H_UNIDAD   = [/^und?$/i, /^u\.?$/i, /unidad/i];
  const H_CANTIDAD = [/cantidad/i, /^cant\.?$/i, /^vol\.?$/i, /volumen/i];
  const H_PU       = [/^p\.?\s*u\.?$/i, /precio\s*unit/i, /^pu$/i];
  const H_IMPORTE  = [/importe/i, /^total$/i, /^monto$/i, /^subtotal$/i];
  const H_PCT      = [/^%/i, /porcent/i, /^pct/i];

  // Analizar columnas
  const dataRows = filas.slice(dataStart);
  const colStats = Array.from({length: nCols}, (_, ci) => ({
    ci,
    numCount: 0, textCount: 0, shortTextCount: 0, longTextCount: 0,
    codeCount: 0, fracCount: 0, nums: [],
    header: headers[ci] || '',
  }));

  dataRows.forEach(row => {
    row.forEach((cell, ci) => {
      if (ci >= nCols) return;
      const s = String(cell || '').trim();
      if (!s) return;
      const n = toNum(s);
      if (n !== 0) {
        colStats[ci].numCount++;
        colStats[ci].nums.push(Math.abs(n));
        if (Math.abs(n) < 1) colStats[ci].fracCount++;
      } else if (isNaN(Number(s.replace(/[$,]/g,'')))) {
        colStats[ci].textCount++;
        colStats[ci].textLengthSum = (colStats[ci].textLengthSum || 0) + s.length;
        if (s.length <= 6) colStats[ci].shortTextCount++;
        if (s.length <= 25) colStats[ci].mediumTextCount = (colStats[ci].mediumTextCount || 0) + 1;
        if (s.length > 15) colStats[ci].longTextCount++;
        if (s.length > 50) colStats[ci].veryLongTextCount = (colStats[ci].veryLongTextCount || 0) + 1;
        // Patrón de CLAVE de presupuesto: texto corto (≤30 chars) con guiones
        // tipo "0219-OAX-TRAZ-03" o clave jerárquica corta como "A1.5"
        if (s.length <= 30 && (
          /^[0-9]{2,4}[-\s]/.test(s) ||           // empieza con código numérico ej "0219-OAX"
          /^[A-Z]{1,3}[0-9]+(\.[0-9]+)*[A-Z]?$/i.test(s) || // jerárquica A1.5
          /^[A-Z]{1,4}$/i.test(s)                  // letras solas A, AB
        )) colStats[ci].codeCount++;
      }
    });
  });
  colStats.forEach(cs => {
    cs.avgNum = cs.nums.length ? cs.nums.reduce((a,b)=>a+b,0) / cs.nums.length : 0;
    cs.maxNum = cs.nums.length ? Math.max(...cs.nums) : 0;
    cs.fracRatio = cs.numCount ? cs.fracCount / cs.numCount : 0;
    cs.avgTextLen = cs.textCount ? (cs.textLengthSum || 0) / cs.textCount : 0;
  });

  // ── Asignar columnas de TEXTO (clave, descripción, unidad)
  let colClave=-1, colDesc=-1, colUnidad=-1;

  // Clave: prioridad header → mayor proporción de códigos cortos.
  // CRÍTICO: la clave debe tener TEXTO CORTO en promedio (≤30 chars).
  // Esto evita confundir descripciones largas con clave por sus guiones internos
  // (ej. "DEMOLICIÓN POR MEDIOS-MANUALES..." matcheaba como código por el guión).
  const claveByHeader = colStats.find(cs => headerMatch(cs.header, H_CLAVE));
  if (claveByHeader) colClave = claveByHeader.ci;
  else {
    let maxCode = 0;
    colStats.forEach(cs => {
      // Promedio de longitud > 30 char = no puede ser clave (es descripción)
      if (cs.avgTextLen > 30) return;
      if (cs.codeCount > maxCode && cs.textCount > dataRows.length * 0.1) {
        maxCode = cs.codeCount; colClave = cs.ci;
      }
    });
  }

  // Descripción: prioridad header → mayor texto largo.
  // Excluir columnas que parezcan "Precio con letra" (empiezan con * o
  // contienen palabras como "PESOS", típicas de Opus "Con letra")
  const pareceColLetra = (cs) => {
    // Si la mayoría de su contenido empieza con "(" o contiene "PESOS", es Con Letra
    // No tenemos el contenido aquí, pero el header nos delata
    return /con\s+letra/i.test(cs.header) || /letra/i.test(cs.header);
  };
  const descByHeader = colStats.find(cs => headerMatch(cs.header, H_DESC));
  if (descByHeader) colDesc = descByHeader.ci;
  else {
    let maxLong = 0;
    colStats.forEach(cs => {
      if (cs.ci === colClave) return;
      if (pareceColLetra(cs)) return;
      if (cs.longTextCount > maxLong) { maxLong = cs.longTextCount; colDesc = cs.ci; }
    });
  }

  // Unidad: prioridad header → texto muy corto que no es clave/desc
  const unidadByHeader = colStats.find(cs => headerMatch(cs.header, H_UNIDAD));
  if (unidadByHeader) colUnidad = unidadByHeader.ci;
  else {
    colStats.forEach(cs => {
      if (cs.ci === colClave || cs.ci === colDesc) return;
      if (cs.shortTextCount > cs.textCount * 0.5 && cs.textCount > 3) colUnidad = cs.ci;
    });
  }

  // ── Asignar columnas NUMÉRICAS (cantidad, PU, importe) por CONSISTENCIA
  // Estrategia: probar todas las combinaciones de 3 columnas numéricas y
  // elegir la que más renglones cumplen cant * PU ≈ importe (±3%)
  const usadas = new Set([colClave, colDesc, colUnidad].filter(x => x >= 0));
  const numCols = colStats.filter(cs => cs.numCount > dataRows.length * 0.05 && !usadas.has(cs.ci));

  // Descartar columnas tipo % (header o todos valores < 1)
  const noEsPct = (cs) => !headerMatch(cs.header, H_PCT) && cs.fracRatio < 0.7;
  const candidatas = numCols.filter(noEsPct);

  // Si hay hints por header, úsalos
  let colCantidad = -1, colPU = -1, colImporte = -1;
  const cantByHeader = candidatas.find(cs => headerMatch(cs.header, H_CANTIDAD));
  const puByHeader = candidatas.find(cs => headerMatch(cs.header, H_PU));
  const impByHeader = candidatas.find(cs => headerMatch(cs.header, H_IMPORTE));
  if (cantByHeader) colCantidad = cantByHeader.ci;
  if (puByHeader)   colPU = puByHeader.ci;
  if (impByHeader)  colImporte = impByHeader.ci;

  // Si falta alguna, decidir por consistencia entre las restantes
  const restantes = candidatas.filter(cs =>
    cs.ci !== colCantidad && cs.ci !== colPU && cs.ci !== colImporte
  );

  // Función de score: cuántos renglones cumplen cant*PU ≈ importe
  const scoreCombo = (ciCant, ciPU, ciImp) => {
    let ok = 0, eval_ = 0;
    dataRows.forEach(row => {
      const c = toNum(row[ciCant]);
      const p = toNum(row[ciPU]);
      const im = Math.abs(toNum(row[ciImp]));
      if (c > 0 && p > 0 && im > 0) {
        eval_++;
        const calc = c * p;
        if (Math.abs(calc - im) / im < 0.03) ok++;
      }
    });
    return eval_ > 0 ? ok / eval_ : 0;
  };

  // Si hay incógnitas, probar combinaciones
  if (colCantidad < 0 || colPU < 0 || colImporte < 0) {
    let bestScore = -1, bestCombo = null;
    // Pool incluye lo que ya tenemos asignado (puede recolocarse) más restantes
    const pool = [...new Set([
      ...(colCantidad >= 0 ? [colCantidad] : []),
      ...(colPU >= 0 ? [colPU] : []),
      ...(colImporte >= 0 ? [colImporte] : []),
      ...restantes.map(r => r.ci),
    ])];
    // Probar todas las permutaciones de 3 entre pool
    for (let a = 0; a < pool.length; a++) {
      for (let b = 0; b < pool.length; b++) {
        for (let c = 0; c < pool.length; c++) {
          if (a===b || a===c || b===c) continue;
          const s = scoreCombo(pool[a], pool[b], pool[c]);
          if (s > bestScore) {
            bestScore = s;
            bestCombo = { cant: pool[a], pu: pool[b], imp: pool[c] };
          }
        }
      }
    }
    if (bestCombo && bestScore > 0.5) {
      // Solo aceptar la combinación si supera el 50% de consistencia
      // y NO contradice un header explícito
      if (colCantidad < 0 || (!cantByHeader)) colCantidad = bestCombo.cant;
      if (colPU < 0 || (!puByHeader))         colPU = bestCombo.pu;
      if (colImporte < 0 || (!impByHeader))   colImporte = bestCombo.imp;
    } else {
      // Fallback: si no hay consistencia (Excel raro), usar promedios
      // Importe = mayor avgNum, PU = segundo, Cantidad = el de menor avgNum
      const sortedByAvg = [...candidatas].sort((a,b) => b.avgNum - a.avgNum);
      if (colImporte < 0 && sortedByAvg[0]) colImporte = sortedByAvg[0].ci;
      if (colPU < 0 && sortedByAvg[1])      colPU = sortedByAvg[1].ci;
      if (colCantidad < 0 && sortedByAvg.length >= 3) {
        // Cantidad: el de menor avg entre los no usados, excluyendo el último si parece %
        const usadasNum = new Set([colImporte, colPU]);
        const restNum = sortedByAvg.filter(cs => !usadasNum.has(cs.ci));
        if (restNum.length) colCantidad = restNum[restNum.length-1].ci;
      }
    }
  }

  // ── Detector de filas-resumen / agrupadores / metadatos repetitivos
  // Cubre tanto totales como pies de página típicos de Opus:
  //   "Acumulado anterior:", "Monto esta hoja:", "Acumulado:", "GERENTE: ..."
  //   "Fecha de Inicio:", "Fecha de Término:", "120 DIAS NAT."
  const PATRONES_TOTAL = [
    /^total\b/i, /^subtotal\b/i, /^suma\b/i,
    /\btotal\s*(general|del|de)\b/i, /^importe\s+total\b/i,
    /^(monto|gran)\s+total\b/i,
    /^acumulado\b/i,            // "Acumulado:", "Acumulado anterior:"
    /^monto\s+esta\s+hoja/i,    // "Monto esta hoja:"
    /^gerente\b/i,              // "GERENTE: C. ..."
    /^residente\b/i,
    /^superintendente\b/i,
    /^elabor[óo]\b/i, /^revis[óo]\b/i, /^autoriz[óo]\b/i,
    /^fecha\s+de\s+(inicio|t[ée]rmino|entrega)/i,
    /^d[ií]as?\s+nat/i,         // "120 DIAS NAT."
    /^obra\b\s*:/i,             // "Obra:"
    /^cliente\b\s*:/i,          // "Cliente:"
    /^domicilio\b/i,
  ];
  // Detecta si una fila es:
  // - "total" / "gran total" / etc. → descartar (no aporta valor, solo duplica)
  // - "categoría/capítulo" (A, A1, A1.5, 1, 1.1, etc.) → preservar como agrupador
  // - "concepto real" → preservar normal
  const esTotalAgregado = (clave, desc) => {
    const txt = (desc || clave || '').trim();
    return txt && PATRONES_TOTAL.some(p => p.test(txt));
  };
  // Patrón ESTRICTO de clave jerárquica para categorías:
  //   A, AB, B, C ............ nivel 1 (capítulo)
  //   A1, A2, A10, B1 ......... nivel 2 (sección)
  //   A1.5, A1.5B, A1.2C ...... nivel 3+ (subsección)
  //   1, 1.1, 1.1.5 ........... numérico puro (máx 3 dígitos por segmento)
  // Limitamos números a 3 dígitos por segmento para evitar fechas seriales
  // de Excel (números tipo 46141 = 2026-04-26) o números sueltos parásitos.
  const PATRON_CLAVE_CAT = /^([A-Z]{1,3}|[A-Z]{1,3}[0-9]{1,3}[A-Z]?|[A-Z]{1,3}[0-9]{1,3}(\.[0-9]{1,3}[A-Z]?)+|[0-9]{1,3}(\.[0-9]{1,3})*)$/;

  // Una fila es categoría SOLO si su clave cumple el patrón jerárquico estricto.
  // Esto evita que metadatos del encabezado del Excel ("120 DIAS NAT.",
  // "Fecha de Término:", filas sueltas con importe, fechas seriales) se
  // interpreten como categorías. Si tiene PU > 0 nunca es categoría (es concepto).
  // Además, la descripción debe ser una descripción real (no acabar en ":" como
  // "Fecha de Inicio:" o "Cliente:").
  const esCategoria = (clave, desc, unidad, cant, pu, importe) => {
    if (pu > 0) return false;
    const claveTrim = (clave || '').trim();
    const descTrim = (desc || '').trim();
    if (!claveTrim) return false;
    // Si la descripción termina en ":" es muy probable que sea metadato
    // (ej. "Fecha de Inicio:", "Obra:", "Cliente:"). Una categoría real
    // tiene una descripción declarativa sin ":".
    if (descTrim.endsWith(':')) return false;
    return PATRON_CLAVE_CAT.test(claveTrim);
  };

  // Una fila se DESCARTA por completo si no es ni concepto ni categoría
  // válida (metadato suelto, encabezado, fila vacía con basura).
  const esRuido = (clave, desc, unidad, cant, pu, importe) => {
    // Concepto válido: tiene PU > 0
    if (pu > 0) return false;
    // Categoría válida: clave jerárquica
    if (esCategoria(clave, desc, unidad, cant, pu, importe)) return false;
    // Cualquier otra cosa sin PU es ruido (metadatos, totales sueltos, etc.)
    return true;
  };

  // ── Parsear conceptos y categorías preservando orden
  // Las categorías se agrupan jerárquicamente: cada concepto se asocia a la
  // categoría más reciente de menor nivel (ej. A1.5 antes que A1 antes que A)
  const filasClasif = [];  // array intercalado de categorías y conceptos en orden
  let totalLeido = 0;
  let cantidadesDeducidas = 0;

  dataRows.forEach((row, ri) => {
    const clave   = colClave   >= 0 ? String(row[colClave]   || '').trim() : '';
    const desc    = colDesc    >= 0 ? String(row[colDesc]    || '').trim() : '';
    const unidad  = colUnidad  >= 0 ? String(row[colUnidad]  || '').trim() : '';
    let cant    = colCantidad >= 0 ? toNum(row[colCantidad]) : 0;
    const pu      = colPU      >= 0 ? toNum(row[colPU])      : 0;
    const importe = colImporte >= 0 ? Math.abs(toNum(row[colImporte])) : 0;

    // Filas completamente vacías
    if (!desc && !clave) return;
    // Descartar totales globales y de capítulo
    // (ej. "A1.1 TOTAL TRABAJOS PRELIMINARES" — empieza con TOTAL en desc)
    if (esTotalAgregado(clave, desc)) return;

    // VERIFICAR CATEGORÍA PRIMERO (antes de filtrar por "sin datos")
    // Las categorías típicamente vienen como filas SOLO con clave + descripción,
    // sin importe ni cantidad. Ej: "A1.1  TRABAJOS PRELIMINARES" sin más datos.
    if (esCategoria(clave, desc, unidad, cant, pu, importe)) {
      // Calcular el "nivel" de jerarquía por número de puntos en la clave
      // A = nivel 1, A1 = nivel 2 (o si es solo num: 1 = nivel 1, 1.1 = nivel 2)
      const claveTrim = (clave || '').trim();
      let nivel = 1;
      if (claveTrim) {
        nivel = claveTrim.split('.').length;
        // Detalle: A1 también es nivel 2 (letra + número)
        if (nivel === 1 && /^[A-Z][0-9]/.test(claveTrim)) nivel = 2;
      }
      filasClasif.push({
        tipo: 'categoria',
        nivel,
        clave: claveTrim || `CAT${ri+1}`,
        desc: desc || '',
        importe,
        _ri: ri,
      });
    } else {
      // No es categoría. Para ser un concepto válido debe tener PU > 0.
      // Sin PU es ruido (pie de página, metadato, fila vacía con números sueltos)
      if (pu <= 0) return;
      // También filtrar filas sin descripción ni clave útil
      if (importe === 0 && cant === 0) return;

      let cantDeducida = false;
      if (pu > 0 && importe > 0) {
        const cantCalc = importe / pu;
        if (cant === 0 || Math.abs(cant * pu - importe) / importe > 0.05) {
          cant = Math.round(cantCalc * 100) / 100;
          cantDeducida = true;
          cantidadesDeducidas++;
        }
      }
      totalLeido += importe;
      const pctContrato = importeContrato > 0 ? (importe / importeContrato * 100) : 0;
      filasClasif.push({
        tipo: 'concepto',
        clave: clave || `C${ri+1}`,
        desc: desc || '(sin descripción)',
        unidad, cant, pu, importe,
        cantDeducida,
        pctContrato: Math.round(pctContrato * 100) / 100,
        avance: 0, fotos: [],
        _ri: ri,
      });
    }
  });

  // conceptos planos (para compatibilidad con el resto del código)
  const conceptos = filasClasif.filter(f => f.tipo === 'concepto').map((c, idx) => ({
    id: String(idx),
    ...c,
  }));
  // categorías con sus conceptos hijos asociados (jerarquía por stack)
  const categorias = [];
  let stackCat = [];
  filasClasif.forEach(f => {
    if (f.tipo === 'categoria') {
      stackCat = stackCat.filter(c => c.nivel < f.nivel);
      const cat = { ...f, hijos: [], padre: stackCat.length > 0 ? stackCat[stackCat.length-1].clave : null };
      categorias.push(cat);
      stackCat.push(cat);
    } else {
      if (stackCat.length > 0) {
        stackCat[stackCat.length-1].hijos.push(f);
      }
    }
  });

  return {
    conceptos,
    categorias,
    filasClasif,
    totalLeido,
    cantidadesDeducidas,
    colsDetectadas: {colClave, colDesc, colUnidad, colCantidad, colPU, colImporte},
    headerDetectado: {
      headerRow,
      dataStart,
      headers: headers.slice(0, 12),
    },
    parserVersion: 'v5-strict-headers',  // me ayuda a saber qué versión generó el catálogo
    nFilasLeidas: dataRows.length,
  };
}

function Presupuesto({obra, setObra, rol, setSubsGlobal}) {
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
      archivo: 'Presupuesto cargado',
      // Debug metadata: nos dice qué versión del parser generó este catálogo
      // y qué columnas detectó. Útil para diagnosticar problemas de mapeo.
      parserVersion: resultado.parserVersion || 'unknown',
      colsDetectadas: resultado.colsDetectadas,
      headerDetectado: resultado.headerDetectado,
    };
    // Convertir conceptos a formato subs para Avance físico.
    // Cada concepto guarda la RUTA COMPLETA de categorías padre (ej. ["A","A1","A1.3"])
    // para reconstruir un árbol jerárquico verdadero en la UI.
    // id ÚNICO por sub: la clave puede repetirse en distintas zonas de la obra.
    const cat2concepto = new Map();  // _ri concepto → categoría inmediata
    (resultado.categorias || []).forEach(cat => {
      cat.hijos.forEach(c => cat2concepto.set(c._ri, { clave: cat.clave, desc: cat.desc, nivel: cat.nivel }));
    });
    // Mapa clave categoría → categoría completa (para resolver ancestros)
    const cat2cat = new Map();
    (resultado.categorias || []).forEach(cat => cat2cat.set(cat.clave, cat));
    // Helper: obtiene la ruta de ancestros de una categoría (de raíz a hoja)
    const rutaAncestros = (claveCat) => {
      const ruta = [];
      let actual = cat2cat.get(claveCat);
      while (actual) {
        ruta.unshift({ clave: actual.clave, desc: actual.desc, nivel: actual.nivel });
        actual = actual.padre ? cat2cat.get(actual.padre) : null;
      }
      return ruta;
    };
    const subsParaAvance = resultado.conceptos.map((c, idx) => {
      const pertenece = cat2concepto.get(c._ri);
      return {
        id: `${c.clave || c.id || 'C'}__${idx}`,
        sec: c.clave || c.id,
        sub: c.desc || '(sin descripción)',
        imp: c.importe || 0,
        n: 1,
        a: 0,
        fotos: {},
        // Categoría inmediata (compatibilidad)
        cat: pertenece ? pertenece.clave : null,
        catDesc: pertenece ? pertenece.desc : null,
        // RUTA COMPLETA de ancestros: ["A", "A1", "A1.3"]
        ruta: pertenece ? rutaAncestros(pertenece.clave) : [],
      };
    });
    // Guardamos también el árbol de categorías para reconstruir la jerarquía
    cat.categorias = (resultado.categorias || []).map(c => ({
      clave: c.clave, desc: c.desc, nivel: c.nivel, padre: c.padre,
    }));
    // Marcar cada sub con la versión del parser (para debug)
    subsParaAvance.forEach(s => { s._parserVersion = resultado.parserVersion || 'unknown'; });
    try {
      await fsSetA(`obras/${obra.id}/config/catalogo`, cat,
        { modulo:"presupuesto", entidad:`catálogo ${cat.conceptos?.length||0} conceptos`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre,
          meta:{ importeTotal: cat.totalLeido, importeContrato } });
      // También guardar como subs para que aparezcan en Operación → Avance físico
      await fsSetA(`obras/${obra.id}/avance/subs`, { data: subsParaAvance },
        { modulo:"avance_fisico", entidad:"sincronización desde catálogo", obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
      setObra({...obra, presupuesto: importeContrato});
      // Actualizar el state global de subs si el padre lo permite (para no requerir reload)
      if (setSubsGlobal) setSubsGlobal(subsParaAvance);
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

  // ── DETECTORES INTELIGENTES DE DUPLICACIÓN ──
  // Si el total leído es ~exactamente un múltiplo entero del contratado (2x, 3x...),
  // probablemente hay filas-resumen incluidas. Sugerimos dividir.
  const detectarDuplicacion = () => {
    if (!resultado || importeContrato <= 0 || resultado.totalLeido <= 0) return null;
    const ratio = resultado.totalLeido / importeContrato;
    // Solo si es múltiplo cercano a entero 2-5
    for (const n of [2, 3, 4, 5]) {
      if (Math.abs(ratio - n) < 0.02) {
        return { multiplo: n, ratio };
      }
    }
    return null;
  };
  const duplicacion = detectarDuplicacion();

  // ── ACCIONES DE AJUSTE ──
  // 1. Dividir todos los importes entre N (típicamente 2)
  const dividirImportesEntre = (n) => {
    if (!resultado || n <= 1) return;
    const nuevos = resultado.conceptos.map(c => ({
      ...c,
      importe: c.importe / n,
      pu: c.pu > 0 ? c.pu / n : c.pu,
      pctContrato: importeContrato > 0 ? ((c.importe / n) / importeContrato * 100) : c.pctContrato,
    }));
    const nuevoTotal = nuevos.reduce((t, c) => t + c.importe, 0);
    setResultado({ ...resultado, conceptos: nuevos, totalLeido: nuevoTotal });
  };

  // 2. Escalar proporcionalmente para que el total = monto contratado
  const ajustarAlContratado = () => {
    if (!resultado || resultado.totalLeido <= 0 || importeContrato <= 0) return;
    const factor = importeContrato / resultado.totalLeido;
    const nuevos = resultado.conceptos.map(c => ({
      ...c,
      importe: c.importe * factor,
      pu: c.pu > 0 ? c.pu * factor : c.pu,
      pctContrato: ((c.importe * factor) / importeContrato * 100),
    }));
    const nuevoTotal = nuevos.reduce((t, c) => t + c.importe, 0);
    setResultado({ ...resultado, conceptos: nuevos, totalLeido: nuevoTotal });
  };

  // 3. Usar el total leído como el monto contratado correcto
  const usarTotalLeido = () => {
    if (!resultado) return;
    setImporteContrato(resultado.totalLeido);
  };

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
              <Kpi label="Conceptos leídos" value={resultado.conceptos.length}
                sub={`de ${resultado.nFilasLeidas} filas${resultado.cantidadesDeducidas>0?` · ${resultado.cantidadesDeducidas} cant. calculadas`:''}`}
                color={C.blue}/>
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
            {/* Banner de duplicación detectada (cuando ratio es ~entero 2-5) */}
            {duplicacion && (
              <div style={{background:`${C.red}10`,border:`1px solid ${C.red}55`,borderRadius:8,
                padding:'12px 14px',marginTop:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.redDk,marginBottom:6}}>
                  ⚠ Posible duplicación detectada ({duplicacion.multiplo}× el monto contratado)
                </div>
                <div style={{fontSize:10,color:C.textSec,marginBottom:10,lineHeight:1.5}}>
                  El archivo probablemente incluye filas de subtotal o total que se están sumando
                  junto con las partidas. Es muy común en presupuestos de obra que el Excel termine
                  con una fila "Total general" que el parser confunde con una partida real.
                </div>
                <button onClick={() => dividirImportesEntre(duplicacion.multiplo)}
                  style={{background:C.red,color:'#fff',border:'none',borderRadius:6,
                    padding:'7px 14px',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                  Dividir todos los importes entre {duplicacion.multiplo}
                </button>
              </div>
            )}

            {/* Botones de ajuste manual cuando no cuadra (sin ser duplicación obvia) */}
            {!duplicacion && pctLeido < 95 && resultado.totalLeido > 0 && (
              <div style={{background:`${C.yellow}10`,border:`0.5px solid ${C.yellow}55`,borderRadius:8,
                padding:'12px 14px',marginTop:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.yellowDk,marginBottom:6}}>
                  Diferencia de {pctLeido < 100 ? `-${(100-pctLeido).toFixed(1)}%` : `+${(pctLeido-100).toFixed(1)}%`} vs monto contratado
                </div>
                <div style={{fontSize:10,color:C.textSec,marginBottom:10,lineHeight:1.5}}>
                  Posibles causas: el archivo tiene filas de subtotales, columnas mal detectadas,
                  o el monto contratado capturado no coincide con el del archivo. Elige cómo cuadrar:
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button onClick={ajustarAlContratado}
                    style={{background:C.caliza,color:C.bg,border:'none',borderRadius:6,
                      padding:'7px 14px',fontSize:10,fontWeight:600,cursor:'pointer'}}>
                    Ajustar importes proporcionalmente al monto contratado
                  </button>
                  <button onClick={usarTotalLeido}
                    style={{background:'transparent',color:C.caliza,border:`0.5px solid ${C.caliza}`,
                      borderRadius:6,padding:'7px 14px',fontSize:10,fontWeight:600,cursor:'pointer'}}>
                    El total leído es correcto, actualizar monto contratado
                  </button>
                </div>
                <div style={{fontSize:9,color:C.textMut,marginTop:8}}>
                  Si ninguna opción aplica, cancela y revisa el archivo antes de subirlo.
                </div>
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
                      <td style={{padding:'5px 8px',textAlign:'right',color:c.cantDeducida?C.yellowDk:C.textSec}}
                        title={c.cantDeducida?'Cantidad calculada como importe/PU porque el Excel no la traía':''}>
                        {c.cant>0?c.cant.toLocaleString('es-MX',{maximumFractionDigits:2}):'—'}
                        {c.cantDeducida && <span style={{fontSize:8,marginLeft:3,opacity:0.7}}>(calc)</span>}
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
        fsSetA(`obras/${obra.id}/nomina/historial`, {semanas:nuevo_hist},
          { modulo:"nomina", entidad:`semana ${nueva.semana} (${nueva.trabajadores.length} trab.)`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre,
            meta:{ totalNomina: nueva.totalNomina } });
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
    const semPrev = historial[idx];
    const nuevo = historial.filter((_,i) => i !== idx);
    fsSetA(`obras/${obra.id}/nomina/historial`, {semanas:nuevo},
      { modulo:"nomina", entidad:`eliminar semana ${semPrev?.semana||idx}`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
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


// ════════════════════════════════════════════════════════════════════════════
// VISTAS PARA ROL CLIENTE
// El cliente NO debe ver costos, márgenes, gastos GP ni datos internos.
// Solo: avance físico, fotos por subsección, sus estimaciones (sin amortizaciones
// internas como FG/Anticipo desglosado), y plazos del contrato.
// ════════════════════════════════════════════════════════════════════════════

// ── AVANCE (CLIENTE): listado de subsecciones con % de avance y barra ──────
function AvanceCliente({obra, subs}){
  // Avance físico total ponderado
  const af = (obra?.presupuesto||0) > 0
    ? subs.reduce((t,s)=>t+((s.a||0)/100)*((s.imp||0)/obra.presupuesto)*100, 0)
    : 0;
  const completadas = subs.filter(s=>(s.a||0)>=100).length;
  const enProceso   = subs.filter(s=>(s.a||0)>0 && (s.a||0)<100).length;
  const sinIniciar  = subs.filter(s=>(s.a||0)===0).length;
  // Ordenadas por importe descendente
  const ordenadas = [...subs].sort((a,b)=>(b.imp||0)-(a.imp||0));

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Card accent={C.blue}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div>
          <Tit>Avance general de la obra</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>Ponderado por importe contractual de cada partida</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:24,fontWeight:700,color:C.blueDk,lineHeight:1}}>{NUM(af,1)}%</div>
          <div style={{fontSize:9,color:C.textMut,marginTop:2}}>de avance acumulado</div>
        </div>
      </div>
      <Bar pct={af} color={C.blueDk}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:14}}>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.green}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em"}}>Completadas</div>
          <div style={{fontSize:15,fontWeight:700,color:C.greenDk,marginTop:2}}>{completadas}</div>
        </div>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.yellow}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em"}}>En proceso</div>
          <div style={{fontSize:15,fontWeight:700,color:C.yellowDk,marginTop:2}}>{enProceso}</div>
        </div>
        <div style={{background:C.bg,borderRadius:8,padding:"9px 11px",borderLeft:`3px solid ${C.textMut}`}}>
          <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em"}}>Sin iniciar</div>
          <div style={{fontSize:15,fontWeight:700,color:C.textSec,marginTop:2}}>{sinIniciar}</div>
        </div>
      </div>
    </Card>

    <Card>
      <Tit>Avance por partida</Tit>
      <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
        {ordenadas.map((s,i)=>{
          const pct = s.a || 0;
          const col = pct>=100 ? C.green : pct>0 ? C.blue : C.textMut;
          const pctContrato = (obra?.presupuesto||0)>0 ? ((s.imp||0)/obra.presupuesto*100) : 0;
          return <div key={s.id || `${s.sec}-${i}`} style={{background:C.bg,borderRadius:8,padding:"9px 11px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:5}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:9,color:C.textMut,fontWeight:600}}>{s.sec}</span>
                  <span style={{fontSize:11,fontWeight:600,color:C.caliza}}>{s.sub}</span>
                </div>
                <div style={{fontSize:9,color:C.textMut,marginTop:1}}>{NUM(pctContrato,1)}% del contrato</div>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:col,flexShrink:0}}>{NUM(pct,1)}%</div>
            </div>
            <Bar pct={pct} color={col}/>
          </div>;
        })}
      </div>
    </Card>
  </div>;
}

// ── FOTOS (CLIENTE): galería de fotos por subsección ────────────────────────
function FotosCliente({obra, subs}){
  const[lightbox,setLightbox]=useState(null);
  // subsecciones con al menos 1 foto
  const conFotos = subs.map(s => {
    const fotos = Array.isArray(s.fotos) ? s.fotos : Object.values(s.fotos||{});
    return {...s, _fotos: fotos};
  }).filter(s => s._fotos.length > 0);

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Card>
      <Tit>Evidencia fotográfica</Tit>
      <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:10}}>
        Fotos cargadas en campo, organizadas por partida
      </div>
      {conFotos.length === 0 && (
        <div style={{padding:30,textAlign:"center",color:C.textMut,fontSize:11}}>
          Aún no se han cargado fotos de esta obra.
        </div>
      )}
      {conFotos.map((s,i) => (
        <div key={s.id || `${s.sec}-${i}`} style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,paddingBottom:5,
            borderBottom:`0.5px solid ${C.border}`}}>
            <span style={{fontSize:9,color:C.textMut,fontWeight:600}}>{s.sec}</span>
            <span style={{fontSize:11,fontWeight:600,color:C.caliza}}>{s.sub}</span>
            <Bdg color={C.blue} small>{s._fotos.length} foto{s._fotos.length>1?"s":""}</Bdg>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:6}}>
            {s._fotos.map((foto,i)=>{
              const url = typeof foto === "string" ? foto : (foto.url || foto.src || "");
              if(!url) return null;
              return <div key={i} onClick={()=>setLightbox(url)}
                style={{background:C.bg,borderRadius:6,overflow:"hidden",cursor:"pointer",aspectRatio:"4/3"}}>
                <img src={url} alt={`${s.sub} ${i+1}`}
                  style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
              </div>;
            })}
          </div>
        </div>
      ))}
    </Card>

    {/* Lightbox simple */}
    {lightbox && <div onClick={()=>setLightbox(null)}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:300,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20,cursor:"pointer"}}>
      <img src={lightbox} style={{maxWidth:"95%",maxHeight:"95%",objectFit:"contain"}}/>
      <button onClick={()=>setLightbox(null)} style={{position:"absolute",top:14,right:14,
        background:"rgba(255,255,255,0.15)",border:"none",borderRadius:99,width:36,height:36,
        color:"#fff",fontSize:18,cursor:"pointer"}}>×</button>
    </div>}
  </div>;
}

// ── ESTIMACIONES (CLIENTE): solo monto + período + estatus ─────────────────
function EstimacionesCliente({obra, estimaciones}){
  const totalEst = estimaciones.reduce((t,e)=>t+(e.monto||0), 0);
  const pagado   = estimaciones.filter(e=>e.estatus==="Pagada").reduce((t,e)=>t+(e.monto||0), 0);
  const enProc   = estimaciones.filter(e=>e.estatus==="En proceso").reduce((t,e)=>t+(e.monto||0), 0);
  const factur   = estimaciones.filter(e=>["Facturada","Aprobada"].includes(e.estatus)).reduce((t,e)=>t+(e.monto||0), 0);
  const porEst   = Math.max((obra?.presupuesto||0) - totalEst, 0);

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Card>
      <Tit>Resumen de estimaciones</Tit>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:7,marginTop:8}}>
        <Kpi label="Total estimado" value={MXN(totalEst)}
          sub={obra?.presupuesto>0?`${NUM(totalEst/obra.presupuesto*100,1)}% del contrato`:""}
          color={C.caliza} size={12}/>
        <Kpi label="Pagado"      value={MXN(pagado)} sub="liquidado"            color={C.greenDk}  size={12}/>
        <Kpi label="Por pagar"   value={MXN(factur)} sub="facturado/aprobado"   color={C.purpleDk} size={12}/>
        <Kpi label="En proceso"  value={MXN(enProc)} sub="en elaboración"       color={C.yellowDk} size={12}/>
        <Kpi label="Por estimar" value={MXN(porEst)} sub="saldo del contrato"   color={C.blueDk}   size={12}/>
      </div>
    </Card>

    <Card>
      <Tit>Relación de estimaciones</Tit>
      <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:8}}>
        Detalle de cada estimación presentada
      </div>
      {estimaciones.length === 0 && (
        <div style={{padding:20,textAlign:"center",fontSize:11,color:C.textMut}}>
          Aún no se han generado estimaciones.
        </div>
      )}
      {estimaciones.map(e => {
        const ecol = EST_COL[e.estatus] || C.yellow;
        return <div key={e.no} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,
          borderLeft:`3px solid ${ecol}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:13,fontWeight:700,color:C.caliza,letterSpacing:"0.06em"}}>EST-0{e.no}</span>
            <Bdg color={ecol}>{e.estatus}</Bdg>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:3}}>Monto</div>
              <div style={{fontSize:13,fontWeight:700,color:C.caliza}}>{MXN(e.monto)}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:3}}>Período</div>
              <div style={{fontSize:11,color:C.textSec}}>{e.periodo||"—"}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.textMut,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:3}}>Fecha factura</div>
              <div style={{fontSize:11,color:C.textSec}}>{e.fechaFact||"—"}</div>
            </div>
          </div>
        </div>;
      })}
    </Card>
  </div>;
}

// ── PLAZOS (CLIENTE): solo lectura de inicio, fin y ampliaciones ───────────
function PlazosCliente({obra}){
  const[ampliaciones,setAmpliaciones]=useState([]);
  useEffect(()=>{
    fsGet(`obras/${obra.id}/contrato/plazos`).then(d=>{
      if(d&&Array.isArray(d.ampliaciones)) setAmpliaciones(d.ampliaciones);
    });
  },[obra.id]);

  const diasPlazo = (ini,fin) => {
    if(!ini||!fin) return null;
    return Math.round((new Date(fin) - new Date(ini))/(1000*60*60*24));
  };

  const hoy = new Date();
  const finVigente = ampliaciones.length>0 ? ampliaciones[ampliaciones.length-1].fecha : obra.fin;
  const totalDias = diasPlazo(obra.inicio, finVigente);
  const transcurridos = obra.inicio ? Math.max(diasPlazo(obra.inicio, hoy.toISOString().slice(0,10))||0, 0) : 0;
  const restantes = totalDias != null ? Math.max(totalDias - transcurridos, 0) : null;
  const pctPlazo = totalDias && totalDias > 0 ? Math.min((transcurridos/totalDias)*100, 100) : 0;

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Card accent={C.green}>
      <Tit>Plazo de la obra</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:10}}>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>Inicio</div>
          <div style={{fontSize:13,fontWeight:600,color:C.green}}>{obra.inicio||"—"}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>Fin vigente</div>
          <div style={{fontSize:13,fontWeight:600,color:ampliaciones.length>0?C.yellow:C.green}}>{finVigente||"—"}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>Duración total</div>
          <div style={{fontSize:13,fontWeight:600,color:C.caliza}}>{totalDias!=null?`${totalDias} días`:"—"}</div>
        </div>
      </div>
      {totalDias != null && totalDias > 0 && <div style={{marginTop:14}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginBottom:4}}>
          <span>Transcurridos: <b style={{color:C.textSec}}>{transcurridos} días</b></span>
          <span>Restantes: <b style={{color:C.textSec}}>{restantes} días</b></span>
        </div>
        <Bar pct={pctPlazo} color={pctPlazo>=100?C.red:pctPlazo>=75?C.yellow:C.green}/>
        <div style={{fontSize:9,color:C.textMut,marginTop:3,textAlign:"right"}}>{NUM(pctPlazo,1)}% del plazo</div>
      </div>}
    </Card>

    {/* Plazo original (si hay ampliaciones, mostrarlo aparte) */}
    {ampliaciones.length > 0 && <Card>
      <div style={{fontSize:11,fontWeight:600,color:C.textPri,marginBottom:6}}>Plazo original</div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.textSec}}>
        <div>Inicio: <b>{obra.inicio||"—"}</b></div>
        <div>Fin: <b>{obra.fin||"—"}</b></div>
        <div>Duración: <b>{diasPlazo(obra.inicio,obra.fin)||0} días</b></div>
      </div>
    </Card>}

    {/* Ampliaciones */}
    {ampliaciones.length > 0 && <Card>
      <Tit>Ampliaciones de plazo</Tit>
      {ampliaciones.map((amp,i) => (
        <div key={amp.id||i} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,
          borderLeft:`3px solid ${i===0?C.yellow:C.orange}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <Bdg color={i===0?C.yellow:C.orange}>Ampliación {i+1}</Bdg>
            <div style={{fontSize:13,fontWeight:700,color:C.caliza}}>{amp.fecha}</div>
          </div>
          {amp.justificacion && <div style={{fontSize:11,color:C.textSec,marginTop:4}}>
            <span style={{fontSize:9,color:C.textMut}}>Justificación: </span>{amp.justificacion}
          </div>}
          {amp.autorizadoPor && <div style={{fontSize:10,color:C.textMut,marginTop:4}}>
            Autorizada por: {amp.autorizadoPor}
          </div>}
          {obra.inicio && <div style={{fontSize:9,color:C.textMut,marginTop:4}}>
            Duración acumulada: {diasPlazo(obra.inicio,amp.fecha)} días
            {obra.fin && ` (+${diasPlazo(obra.fin,amp.fecha)} días vs plazo original)`}
          </div>}
        </div>
      ))}
    </Card>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// SUBCONTRATOS
// Cada obra puede tener N subcontratos. Cada subcontrato tiene su propio
// catálogo de conceptos, avance por concepto y fotos por concepto.
// Estructura Firestore: obras/{obraId}/subcontratos/lista = { items: [...] }
// ════════════════════════════════════════════════════════════════════════════

function Subcontratos({obra, rol, items, setItems, usuario}){
  const editar = can(rol, "captura", "editar");
  const[seleccionado,setSeleccionado]=useState(null); // id de subcontrato abierto
  const[modalNuevo,setModalNuevo]=useState(false);
  const[saved,setSaved]=useState(false);
  const cargando = false; // el state ya viene del padre, ya está cargado

  const guardar = async (nuevos) => {
    setItems(nuevos);
    const r = await fsSetA(`obras/${obra.id}/subcontratos/lista`, {items: nuevos},
      { modulo:"subcontratos", entidad:`${nuevos.length} subcontratos`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
    if(r){ setSaved(true); setTimeout(()=>setSaved(false), 2000); }
  };

  const crear = (data) => {
    const id = `SC-${Date.now()}`;
    const nuevo = {
      id, nombre: data.nombre, proveedor: data.proveedor, monto: data.monto || 0,
      fechaInicio: data.fechaInicio || "", fechaFin: data.fechaFin || "",
      descripcion: data.descripcion || "", estado: "activa",
      conceptos: [], notas: "", creadoEn: new Date().toISOString(),
    };
    guardar([...items, nuevo]);
    setModalNuevo(false);
    setSeleccionado(id);
    // Notif a directivos sobre el nuevo subcontrato
    notifARoles(['director_general','director_operaciones','admin_sistema'], {
      categoria: 'gestion', tipo: 'subcontrato_nuevo',
      titulo: `Nuevo subcontrato · ${obra.nombre || obra.id}`,
      mensaje: `${data.nombre} · ${data.proveedor} · ${MXN(data.monto || 0)}`,
      link: { tab:'operacion', subTab:'subcontratos', obraId: obra.id },
      creadaPor: usuario?.correo || 'sistema',
    });
  };

  const actualizar = (id, cambios) => {
    guardar(items.map(s => s.id === id ? {...s, ...cambios} : s));
  };

  const eliminar = (id) => {
    if(!window.confirm("¿Eliminar este subcontrato? Los datos no se pueden recuperar.")) return;
    guardar(items.filter(s => s.id !== id));
    if(seleccionado === id) setSeleccionado(null);
  };

  // Si hay uno abierto, mostrar el detalle
  const detalle = items.find(s => s.id === seleccionado);

  if(detalle){
    return <DetalleSubcontrato sub={detalle} editar={editar} obra={obra} usuario={usuario}
      onUpdate={cambios => actualizar(detalle.id, cambios)}
      onVolver={()=>setSeleccionado(null)}
      onEliminar={()=>eliminar(detalle.id)}/>;
  }

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {modalNuevo && <ModalNuevoSubcontrato onSave={crear} onClose={()=>setModalNuevo(false)}/>}

    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div>
          <Tit>Subcontratos de la obra</Tit>
          <div style={{fontSize:9,color:C.textMut,marginTop:-6}}>{items.length} registrado(s)</div>
        </div>
        {editar && <button onClick={()=>setModalNuevo(true)} style={{background:C.caliza,border:"none",
          borderRadius:6,padding:"6px 14px",fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer"}}>
          + Nuevo subcontrato
        </button>}
      </div>

      {cargando && <div style={{padding:20,textAlign:"center",color:C.textMut,fontSize:11}}>Cargando…</div>}
      {!cargando && items.length === 0 && (
        <div style={{padding:30,textAlign:"center",color:C.textMut,fontSize:11}}>
          Aún no hay subcontratos. {editar?'Click "+ Nuevo subcontrato" para registrar el primero.':''}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {items.map(s => {
          const totalConceptos = s.conceptos.reduce((t,c)=>t+(c.importe||0), 0);
          const ejecutado = s.conceptos.reduce((t,c)=>t+((c.avance||0)/100)*(c.importe||0), 0);
          const pctAvance = totalConceptos > 0 ? (ejecutado/totalConceptos)*100 : 0;
          const stCol = s.estado === "completada" ? C.green : s.estado === "pausada" ? C.yellow : C.blue;
          return <div key={s.id} onClick={()=>setSeleccionado(s.id)}
            style={{background:C.bg,borderRadius:10,padding:"13px 15px",cursor:"pointer",
              borderLeft:`3px solid ${stCol}`,transition:"background .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.surface}
            onMouseLeave={e=>e.currentTarget.style.background=C.bg}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:700,color:C.caliza,marginBottom:2}}>{s.nombre}</div>
                <div style={{fontSize:10,color:C.textMut}}>{s.proveedor||"Sin proveedor"}</div>
              </div>
              <Bdg color={stCol}>{(s.estado||"activa").toUpperCase()}</Bdg>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
              {[["Monto contratado",MXN(s.monto||0),C.textPri],
                ["Conceptos",String(s.conceptos.length),C.textSec],
                ["Ejecutado",MXN(ejecutado),C.greenDk],
                ["Avance",`${NUM(pctAvance,1)}%`,pctAvance>=100?C.green:C.blue]].map(([l,v,c])=>
                <div key={l}>
                  <div style={{fontSize:9,color:C.textMut,marginBottom:1}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:600,color:c}}>{v}</div>
                </div>)}
            </div>
            <Bar pct={pctAvance} color={pctAvance>=100?C.green:C.blue}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:9,color:C.textMut,marginTop:6}}>
              <span>{s.fechaInicio?`Inicio: ${s.fechaInicio}`:""}{s.fechaFin?` · Fin: ${s.fechaFin}`:""}</span>
              <span style={{color:C.caliza,fontWeight:600}}>Abrir detalle →</span>
            </div>
          </div>;
        })}
      </div>
      {saved && <div style={{position:"fixed",bottom:60,right:20,background:C.green,color:"#fff",
        padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,zIndex:50}}>Guardado</div>}
    </Card>
  </div>;
}

// ── MODAL NUEVO SUBCONTRATO ──
function ModalNuevoSubcontrato({onSave, onClose}){
  const[form,setForm]=useState({nombre:"",proveedor:"",monto:0,fechaInicio:"",fechaFin:"",descripcion:""});
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:210,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"white",borderRadius:12,padding:20,width:"100%",maxWidth:460,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{fontSize:14,fontWeight:700,color:C.caliza,marginBottom:14}}>Nuevo subcontrato</div>
      {[
        ["Nombre del subcontrato","nombre","text","Ej: Electrificación nave 1"],
        ["Proveedor / Contratista","proveedor","text","Razón social del subcontratista"],
        ["Monto contratado (SIN IVA, MXN)","monto","number","0"],
        ["Fecha de inicio","fechaInicio","date",""],
        ["Fecha de fin","fechaFin","date",""],
        ["Descripción / Alcance","descripcion","textarea","Breve resumen del alcance contratado"],
      ].map(([lbl,key,type,ph])=>(
        <div key={key} style={{marginBottom:10}}>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.04em"}}>{lbl}</div>
          {type==="textarea" ? (
            <textarea value={form[key]} placeholder={ph} rows={3}
              onChange={e=>setForm({...form,[key]:e.target.value})}
              style={{width:"100%",padding:"7px 10px",fontSize:11,border:`0.5px solid ${C.borderM}`,
                borderRadius:6,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
          ) : (
            <Inp type={type} value={form[key]} placeholder={ph}
              onChange={e=>setForm({...form,[key]:type==="number"?parseFloat(e.target.value)||0:e.target.value})}/>
          )}
        </div>
      ))}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
        <SecBtn onClick={onClose}>Cancelar</SecBtn>
        <button onClick={()=>{
          if(!form.nombre||!form.proveedor) { alert("Nombre y proveedor son requeridos"); return; }
          onSave(form);
        }} style={{background:C.caliza,border:"none",borderRadius:6,padding:"7px 14px",
          fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer"}}>
          Crear subcontrato
        </button>
      </div>
    </div>
  </div>;
}

// ── DETALLE DE UN SUBCONTRATO ──
function DetalleSubcontrato({sub, editar, obra, onUpdate, onVolver, onEliminar, usuario}){
  const[subtab,setSubtab]=useState("datos"); // datos | catalogo | fotos
  const[conceptoFotos,setConceptoFotos]=useState(null); // concepto al que se cargan fotos
  const[lightbox,setLightbox]=useState(null);
  const[importPanel,setImportPanel]=useState(false);    // panel de importar catálogo
  const[importBusy,setImportBusy]=useState(false);
  const[importError,setImportError]=useState("");
  const[importResultado,setImportResultado]=useState(null); // {conceptos, totalLeido, nFilasLeidas}
  const[importModo,setImportModo]=useState("reemplazar"); // reemplazar | agregar
  const fileImportRef = useRef();
  const fileAdjuntoRef = useRef();
  const[uploadingAdj,setUploadingAdj]=useState(false);

  const totalCat = sub.conceptos.reduce((t,c)=>t+(c.importe||0), 0);
  const ejecutado = sub.conceptos.reduce((t,c)=>t+((c.avance||0)/100)*(c.importe||0), 0);
  const pctAvance = totalCat > 0 ? (ejecutado/totalCat)*100 : 0;
  // VALIDACIÓN DE MONTO: comparar lo escrito (sub.monto) vs suma del catálogo (totalCat)
  const montoContrato = sub.monto || 0;
  const difMonto = totalCat - montoContrato;
  const pctDif = montoContrato > 0 ? Math.abs(difMonto / montoContrato) * 100 : 0;
  let validacion = null;
  if (sub.conceptos.length > 0 && montoContrato > 0) {
    if (pctDif <= 1) validacion = { color: C.green, txt: "Cuadra", icon: "✓" };
    else if (pctDif <= 5) validacion = { color: C.yellow, txt: "Desviación menor", icon: "!" };
    else validacion = { color: C.red, txt: "Revisar", icon: "⚠" };
  }

  const SUBTABS = [["datos","Datos generales"],["catalogo","Catálogo de conceptos"],["fotos","Fotos por concepto"],["pagos","Pagos"]];

  // ── PAGOS AL SUBCONTRATISTA ──
  // Cada pago: { id, fecha, monto, referencia (folio/cheque/concepto), estatus (programado/pagado/cancelado) }
  const pagos = Array.isArray(sub.pagos) ? sub.pagos : [];
  const totalPagado = pagos.filter(p=>p.estatus==="pagado").reduce((t,p)=>t+(p.monto||0), 0);
  const totalProgramado = pagos.filter(p=>p.estatus==="programado").reduce((t,p)=>t+(p.monto||0), 0);
  const pctFinanciero = montoContrato > 0 ? (totalPagado/montoContrato)*100 : 0;

  const agregarPago = () => {
    const nuevos = [...pagos, {id: Date.now(), fecha: new Date().toISOString().slice(0,10), monto: 0, referencia: "", estatus: "programado"}];
    onUpdate({pagos: nuevos});
  };
  const actualizarPago = (idx, cambios) => {
    const pagoPrev = pagos[idx];
    const pagoNuevo = {...pagoPrev, ...cambios};
    onUpdate({pagos: pagos.map((p,i) => i===idx ? pagoNuevo : p)});
    // Notif si pasó a "pagado" y antes no lo estaba
    if (cambios.estatus === 'pagado' && pagoPrev.estatus !== 'pagado' && pagoNuevo.monto > 0) {
      notifARoles(['director_general','director_operaciones','admin_sistema'], {
        categoria: 'financiero', tipo: 'pago_sub',
        titulo: `Pago registrado · ${sub.proveedor || sub.nombre}`,
        mensaje: `${MXN(pagoNuevo.monto)} · ${obra.nombre || obra.id}${pagoNuevo.referencia ? ' · '+pagoNuevo.referencia : ''}`,
        link: { tab:'operacion', subTab:'subcontratos', obraId: obra.id },
        creadaPor: usuario?.correo || 'sistema',
      });
    }
  };
  const eliminarPago = (idx) => {
    onUpdate({pagos: pagos.filter((_,i) => i !== idx)});
  };

  // ── IMPORTAR CATÁLOGO DESDE EXCEL/CSV ──
  // Carga SheetJS si no está
  useEffect(() => {
    if (typeof window.XLSX === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      document.head.appendChild(s);
    }
  }, []);

  const procesarImport = (file) => {
    if(!file) return;
    setImportBusy(true); setImportError(""); setImportResultado(null);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        let rows;
        if (ext === 'csv') {
          const text = new TextDecoder().decode(e.target.result);
          rows = text.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g,'')));
        } else if (ext === 'xlsx' || ext === 'xls') {
          if (typeof window.XLSX === 'undefined') {
            setImportError("La librería XLSX está cargando. Espera 2 segundos y vuelve a intentar.");
            setImportBusy(false);
            return;
          }
          const wb = window.XLSX.read(e.target.result, {type:'array'});
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
        } else {
          setImportError("Formato no soportado para parseo automático. Usa .xlsx, .xls o .csv. Para PDF, adjúntalo en 'Datos generales' como respaldo y captura el catálogo manualmente.");
          setImportBusy(false);
          return;
        }
        // Reusar el parser global con el monto del subcontrato como referencia
        const res = parsearPresupuesto(rows, montoContrato);
        if (!res.conceptos || res.conceptos.length === 0) {
          setImportError("No se detectaron partidas válidas en el archivo. Verifica formato.");
        } else {
          setImportResultado(res);
        }
      } catch (err) {
        setImportError("Error al leer el archivo: " + err.message);
      }
      setImportBusy(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmarImport = () => {
    if (!importResultado) return;
    // Convertir a formato del subcontrato (id, clave, desc, unidad, cantidad, pu, importe, avance, fotos)
    const nuevos = importResultado.conceptos.map((c, i) => ({
      id: Date.now() + i,
      clave: c.clave || "",
      desc: c.desc || "",
      unidad: c.unidad || "",
      cantidad: c.cant || 0,
      pu: c.pu || 0,
      importe: c.importe || 0,
      avance: 0,
      fotos: [],
    }));
    const conceptosFinales = importModo === "reemplazar"
      ? nuevos
      : [...sub.conceptos, ...nuevos];
    onUpdate({ conceptos: conceptosFinales });
    setImportPanel(false);
    setImportResultado(null);
    setSubtab("catalogo");
  };

  // ── DOCUMENTO ADJUNTO (cotización original PDF/imagen/Excel) ──
  const subirAdjunto = async (file) => {
    if(!file) return;
    setUploadingAdj(true);
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const ext = file.name.split('.').pop().toLowerCase();
        const fileId = `cotizacion_${Date.now()}`;
        const url = await uploadFoto(obra.id, `subdoc_${sub.id}`, fileId, e.target.result);
        onUpdate({ adjunto: { url, nombre: file.name, ext, tamano: file.size, fecha: new Date().toISOString().slice(0,10) } });
      } catch (err) {
        console.error(err);
        alert("Error al subir documento: " + err.message);
      }
      setUploadingAdj(false);
    };
    reader.readAsDataURL(file);
  };

  const eliminarAdjunto = () => {
    if (!window.confirm("¿Eliminar el documento adjunto?")) return;
    onUpdate({ adjunto: null });
  };

  // Helpers de edición de conceptos
  const agregarConcepto = () => {
    onUpdate({conceptos: [...sub.conceptos,
      {id: Date.now(), clave:"", desc:"", unidad:"", cantidad:0, pu:0, importe:0, avance:0, fotos:[]}]});
  };
  const actualizarConcepto = (idx, cambios) => {
    onUpdate({conceptos: sub.conceptos.map((c,i) => {
      if(i !== idx) return c;
      const nuevo = {...c, ...cambios};
      if(("cantidad" in cambios) || ("pu" in cambios)) nuevo.importe = (nuevo.cantidad||0)*(nuevo.pu||0);
      return nuevo;
    })});
  };
  const eliminarConcepto = (idx) => {
    onUpdate({conceptos: sub.conceptos.filter((_,i) => i !== idx)});
  };

  // Subir foto a concepto
  const subirFotoConcepto = async (conceptoIdx, file) => {
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const url = await uploadFoto(obra.id, `sub_${sub.id}_${conceptoIdx}`, Date.now().toString(), e.target.result);
        const concepto = sub.conceptos[conceptoIdx];
        const fotos = [...(concepto.fotos||[]), {url, fecha: new Date().toISOString().slice(0,10)}];
        actualizarConcepto(conceptoIdx, {fotos});
      } catch(err){ console.error(err); alert("Error al subir foto"); }
    };
    reader.readAsDataURL(file);
  };
  const eliminarFotoConcepto = (conceptoIdx, fotoIdx) => {
    const concepto = sub.conceptos[conceptoIdx];
    const fotos = (concepto.fotos||[]).filter((_,i) => i !== fotoIdx);
    actualizarConcepto(conceptoIdx, {fotos});
  };

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    {/* Header con navegación */}
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <button onClick={onVolver} style={{background:"none",border:`0.5px solid ${C.border}`,
            borderRadius:6,padding:"3px 10px",fontSize:10,color:C.textSec,cursor:"pointer",marginBottom:8}}>
            ← Todos los subcontratos
          </button>
          <div style={{fontSize:15,fontWeight:700,color:C.caliza}}>{sub.nombre}</div>
          <div style={{fontSize:11,color:C.textSec,marginTop:2}}>{sub.proveedor}</div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{display:"flex",gap:14,alignItems:"flex-end"}}>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:pctAvance>=100?C.green:C.blue,lineHeight:1}}>{NUM(pctAvance,1)}%</div>
              <div style={{fontSize:8,color:C.textMut,marginTop:2,textTransform:"uppercase"}}>Físico</div>
            </div>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:pctFinanciero>=100?C.green:C.purpleDk,lineHeight:1}}>{NUM(pctFinanciero,1)}%</div>
              <div style={{fontSize:8,color:C.textMut,marginTop:2,textTransform:"uppercase"}}>Financiero</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:7}}>
        <Kpi label="Monto contrato" value={MXN(montoContrato)} color={C.caliza} size={12}/>
        <Kpi label="Total catálogo"  value={MXN(totalCat)}    sub={validacion ? `dif ${MXN(Math.abs(difMonto))} (${NUM(pctDif,2)}%)` : "captura conceptos"} color={validacion?.color || C.blue} size={12}/>
        <Kpi label="Ejecutado"       value={MXN(ejecutado)}   sub={`${NUM(pctAvance,1)}% del cat\u00e1logo`} color={C.greenDk} size={12}/>
        <Kpi label="Pagado"          value={MXN(totalPagado)} sub={`${NUM(pctFinanciero,1)}% del contrato`} color={C.purpleDk} size={12}/>
      </div>
      {/* Validador de monto: barra y mensaje */}
      {validacion && (
        <div style={{background:`${validacion.color}12`,border:`0.5px solid ${validacion.color}44`,
          borderRadius:8,padding:"8px 11px",marginTop:10,
          display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:14,fontWeight:700,color:validacion.color}}>{validacion.icon}</span>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:validacion.color}}>
                {validacion.txt}: {difMonto > 0 ? "+" : ""}{MXN(difMonto)} ({NUM(pctDif,2)}%)
              </div>
              <div style={{fontSize:9,color:C.textMut,marginTop:1}}>
                {difMonto > 0 ? "Catálogo excede el monto contratado — ajusta cantidades o P.U." :
                 difMonto < 0 ? "Catálogo está por debajo del contrato — faltan partidas o ajustar precios" :
                 "Catálogo coincide exactamente con el contrato"}
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{marginTop:10}}>
        <Bar pct={pctAvance} color={pctAvance>=100?C.green:C.blue}/>
      </div>
    </Card>

    {/* Sub-tabs */}
    <div className="noscroll" style={{display:"flex",gap:4,overflowX:"auto",flexShrink:0}}>
      {SUBTABS.map(([id,lbl])=>(
        <button key={id} onClick={()=>setSubtab(id)} style={{flex:"0 0 auto",padding:"7px 14px",
          fontSize:11,borderRadius:8,background:subtab===id?C.caliza:C.card,
          border:`0.5px solid ${subtab===id?C.caliza:C.border}`,
          color:subtab===id?C.bg:C.textSec,fontWeight:subtab===id?700:400,whiteSpace:"nowrap"}}>
          {lbl}
        </button>
      ))}
    </div>

    {/* DATOS GENERALES */}
    {subtab==="datos" && <Card>
      <Tit>Datos del subcontrato</Tit>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:10}}>
        {[
          ["Nombre","nombre","text"],
          ["Proveedor","proveedor","text"],
          ["Monto contratado (SIN IVA)","monto","number"],
          ["Fecha inicio","fechaInicio","date"],
          ["Fecha fin","fechaFin","date"],
          ["Estado","estado","select"],
        ].map(([lbl,key,type])=>(
          <div key={key}>
            <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>{lbl}</div>
            {type==="select" ? (
              editar ? <Sel value={sub[key]||"activa"} onChange={e=>onUpdate({[key]:e.target.value})}>
                <option value="activa">Activa</option>
                <option value="pausada">Pausada</option>
                <option value="completada">Completada</option>
                <option value="cancelada">Cancelada</option>
              </Sel> : <div style={{fontSize:12,color:C.textSec,padding:"5px 0",borderBottom:`0.5px solid ${C.border}`}}>{sub[key]||"—"}</div>
            ) : (
              editar ? <Inp type={type} value={sub[key]||""}
                onChange={e=>onUpdate({[key]:type==="number"?parseFloat(e.target.value)||0:e.target.value})}/>
              : <div style={{fontSize:12,color:C.textSec,padding:"5px 0",borderBottom:`0.5px solid ${C.border}`}}>
                  {type==="number"?MXN(sub[key]||0):(sub[key]||"—")}
                </div>
            )}
          </div>
        ))}
      </div>
      <div style={{marginTop:12}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Descripción / Alcance</div>
        {editar ? <textarea value={sub.descripcion||""} rows={3}
          onChange={e=>onUpdate({descripcion:e.target.value})}
          style={{width:"100%",padding:"7px 10px",fontSize:11,border:`0.5px solid ${C.borderM}`,
            borderRadius:6,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
        : <div style={{fontSize:11,color:C.textSec,padding:"5px 0"}}>{sub.descripcion||"—"}</div>}
      </div>
      <div style={{marginTop:10}}>
        <div style={{fontSize:9,color:C.textMut,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Notas internas</div>
        {editar ? <textarea value={sub.notas||""} rows={2}
          onChange={e=>onUpdate({notas:e.target.value})}
          style={{width:"100%",padding:"7px 10px",fontSize:11,border:`0.5px solid ${C.borderM}`,
            borderRadius:6,fontFamily:"inherit",outline:"none",resize:"vertical"}}/>
        : <div style={{fontSize:11,color:C.textSec,padding:"5px 0"}}>{sub.notas||"—"}</div>}
      </div>

      {/* Documento original adjunto (cotización/contrato firmado) */}
      <div style={{marginTop:14,paddingTop:12,borderTop:`0.5px solid ${C.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div>
            <div style={{fontSize:10,fontWeight:600,color:C.textPri,letterSpacing:"0.02em"}}>DOCUMENTO ORIGINAL</div>
            <div style={{fontSize:9,color:C.textMut,marginTop:2}}>Cotización o contrato firmado por el subcontratista (PDF, Excel o imagen)</div>
          </div>
          {editar && !sub.adjunto && (
            <label style={{background:C.caliza,color:C.bg,padding:"5px 12px",borderRadius:6,
              fontSize:11,fontWeight:600,cursor:"pointer",opacity:uploadingAdj?0.5:1}}>
              {uploadingAdj ? "Subiendo..." : "+ Subir documento"}
              <input ref={fileAdjuntoRef} type="file"
                accept=".pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png"
                style={{display:"none"}}
                disabled={uploadingAdj}
                onChange={e=>{ if(e.target.files?.[0]) subirAdjunto(e.target.files[0]); e.target.value=""; }}/>
            </label>
          )}
        </div>
        {sub.adjunto ? (
          <div style={{background:C.bg,borderRadius:8,padding:"10px 12px",
            display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:C.caliza,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {sub.adjunto.nombre}
              </div>
              <div style={{fontSize:9,color:C.textMut,marginTop:2}}>
                {sub.adjunto.ext?.toUpperCase()} · subido {sub.adjunto.fecha}
                {sub.adjunto.tamano ? ` · ${Math.round(sub.adjunto.tamano/1024)} KB` : ""}
              </div>
            </div>
            <a href={sub.adjunto.url} target="_blank" rel="noopener noreferrer"
              style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:6,
                padding:"4px 10px",fontSize:10,color:C.textSec,textDecoration:"none",whiteSpace:"nowrap"}}>
              Ver / Descargar
            </a>
            {editar && <button onClick={eliminarAdjunto}
              style={{background:"none",border:`0.5px solid ${C.red}44`,borderRadius:6,
                padding:"4px 8px",fontSize:10,color:C.red,cursor:"pointer"}}>×</button>}
          </div>
        ) : (
          <div style={{fontSize:10,color:C.textMut,padding:"8px 0"}}>Sin documento adjunto.</div>
        )}
      </div>

      {editar && <div style={{marginTop:18,paddingTop:14,borderTop:`0.5px solid ${C.border}`,display:"flex",justifyContent:"flex-end"}}>
        <button onClick={onEliminar} style={{background:"none",border:`0.5px solid ${C.red}66`,
          borderRadius:6,padding:"6px 14px",fontSize:11,color:C.redDk,cursor:"pointer"}}>
          Eliminar subcontrato
        </button>
      </div>}
    </Card>}

    {/* CATÁLOGO DE CONCEPTOS */}
    {subtab==="catalogo" && <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:6}}>
        <Tit>Catálogo de conceptos</Tit>
        {editar && (
          <div style={{display:"flex",gap:6}}>
            <SecBtn onClick={()=>setImportPanel(!importPanel)}>{importPanel ? "Cerrar" : "+ Importar catálogo"}</SecBtn>
            <SecBtn onClick={agregarConcepto}>+ Concepto</SecBtn>
          </div>
        )}
      </div>

      {/* PANEL DE IMPORTACIÓN */}
      {importPanel && editar && (
        <div style={{background:C.bg,border:`0.5px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:600,color:C.textPri,marginBottom:8}}>
            Importar catálogo desde archivo
          </div>

          {/* Selector de modo (reemplazar vs agregar) */}
          {sub.conceptos.length > 0 && (
            <div style={{display:"flex",gap:14,marginBottom:10}}>
              <label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:C.textSec,cursor:"pointer"}}>
                <input type="radio" name="importModo" value="reemplazar"
                  checked={importModo==="reemplazar"} onChange={()=>setImportModo("reemplazar")}/>
                <span><b>Reemplazar</b> catálogo actual ({sub.conceptos.length} conceptos)</span>
              </label>
              <label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:C.textSec,cursor:"pointer"}}>
                <input type="radio" name="importModo" value="agregar"
                  checked={importModo==="agregar"} onChange={()=>setImportModo("agregar")}/>
                <span><b>Agregar</b> al catálogo existente</span>
              </label>
            </div>
          )}

          {/* Dropzone */}
          <div style={{border:`1.5px dashed ${C.borderM}`,borderRadius:8,padding:18,textAlign:"center",
            cursor:"pointer",transition:"border-color .2s"}}
            onClick={()=>fileImportRef.current?.click()}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.caliza;}}
            onDragLeave={e=>{e.currentTarget.style.borderColor=C.borderM;}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.borderM;procesarImport(e.dataTransfer.files[0]);}}>
            {importBusy
              ? <div style={{fontSize:12,color:C.caliza}}>Analizando archivo...</div>
              : <>
                  <div style={{fontSize:12,fontWeight:600,color:C.textSec,marginBottom:3}}>
                    Arrastra aquí el archivo del catálogo
                  </div>
                  <div style={{fontSize:9,color:C.textMut}}>
                    Formatos: .xlsx, .xls, .csv · El parser detecta automáticamente clave, descripción, unidad, cantidad, P.U. e importe
                  </div>
                  <div style={{fontSize:9,color:C.textMut,marginTop:4}}>
                    Para PDF: adjúntalo como respaldo en "Datos generales" y captura el catálogo a mano.
                  </div>
                </>}
          </div>
          <input ref={fileImportRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}}
            onChange={e=>{ if(e.target.files?.[0]) procesarImport(e.target.files[0]); e.target.value=""; }}/>

          {importError && (
            <div style={{background:`${C.red}15`,border:`0.5px solid ${C.red}55`,borderRadius:6,
              padding:"7px 10px",fontSize:10,color:C.redDk,marginTop:8}}>
              {importError}
            </div>
          )}

          {/* Preview de resultados */}
          {importResultado && (
            <div style={{marginTop:12}}>
              {(() => {
                const dif = importResultado.totalLeido - montoContrato;
                const pct = montoContrato > 0 ? Math.abs(dif/montoContrato)*100 : 0;
                const ok = montoContrato === 0 ? null : pct <= 1 ? {color:C.green,txt:"Cuadra"} : pct <= 5 ? {color:C.yellow,txt:"Desviación menor"} : {color:C.red,txt:"Revisar"};
                return <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:7,marginBottom:8}}>
                    <Kpi label="Conceptos" value={importResultado.conceptos.length} sub={`de ${importResultado.nFilasLeidas} filas`} color={C.blue}/>
                    <Kpi label="Monto contrato" value={MXN(montoContrato)} sub="capturado" color={C.caliza} size={12}/>
                    <Kpi label="Total leído"   value={MXN(importResultado.totalLeido)} sub="suma del archivo" color={C.green} size={12}/>
                    {ok && <Kpi label="Diferencia" value={MXN(Math.abs(dif))} sub={`${ok.txt} (${NUM(pct,2)}%)`} color={ok.color} size={12}/>}
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end",gap:6,marginTop:10}}>
                    <SecBtn onClick={()=>{setImportResultado(null);setImportError("");}}>Limpiar</SecBtn>
                    <button onClick={confirmarImport}
                      style={{background:C.caliza,border:"none",borderRadius:6,padding:"7px 14px",
                        fontSize:11,fontWeight:700,color:C.bg,cursor:"pointer"}}>
                      {importModo==="reemplazar" ? "Reemplazar catálogo" : "Agregar conceptos"}
                    </button>
                  </div>
                </>;
              })()}
            </div>
          )}
        </div>
      )}

      {sub.conceptos.length === 0 && !importPanel && (
        <div style={{padding:20,textAlign:"center",color:C.textMut,fontSize:11}}>
          {editar?'Sin conceptos. Click "+ Concepto" para capturar a mano o "+ Importar catálogo" para subir desde Excel.':'Sin conceptos registrados.'}
        </div>
      )}
      {sub.conceptos.map((c,i)=>(
        <div key={c.id||i} style={{background:C.bg,borderRadius:8,padding:"10px 12px",marginBottom:8,
          borderLeft:`3px solid ${(c.avance||0)>=100?C.green:(c.avance||0)>0?C.blue:C.textMut}`}}>
          <div style={{display:"grid",gridTemplateColumns:"80px 1fr 60px 90px 90px 110px 70px 30px",gap:6,alignItems:"center"}}>
            {editar ? (<>
              <Inp type="text" value={c.clave||""} placeholder="Clave" style={{fontSize:10}}
                onChange={e=>actualizarConcepto(i,{clave:e.target.value})}/>
              <Inp type="text" value={c.desc||""} placeholder="Descripción" style={{fontSize:10}}
                onChange={e=>actualizarConcepto(i,{desc:e.target.value})}/>
              <Inp type="text" value={c.unidad||""} placeholder="Und" style={{fontSize:10}}
                onChange={e=>actualizarConcepto(i,{unidad:e.target.value})}/>
              <Inp type="number" value={c.cantidad||0} placeholder="Cant" style={{fontSize:10}}
                onChange={e=>actualizarConcepto(i,{cantidad:parseFloat(e.target.value)||0})}/>
              <Inp type="number" value={c.pu||0} placeholder="P.U." style={{fontSize:10}}
                onChange={e=>actualizarConcepto(i,{pu:parseFloat(e.target.value)||0})}/>
              <div style={{fontSize:11,fontWeight:600,color:C.caliza,textAlign:"right"}}>{MXN(c.importe||0)}</div>
              <Inp type="number" value={c.avance||0} placeholder="%" style={{fontSize:10}}
                onChange={e=>actualizarConcepto(i,{avance:Math.min(Math.max(parseFloat(e.target.value)||0,0),100)})}/>
              <button onClick={()=>eliminarConcepto(i)} style={{background:"none",border:"none",
                color:C.red,fontSize:14,cursor:"pointer"}}>×</button>
            </>) : (<>
              <span style={{fontSize:9,color:C.textMut,fontWeight:600}}>{c.clave||"—"}</span>
              <span style={{fontSize:11,color:C.textPri}}>{c.desc||"—"}</span>
              <span style={{fontSize:10,color:C.textSec}}>{c.unidad||"—"}</span>
              <span style={{fontSize:10,color:C.textSec,textAlign:"right"}}>{NUM(c.cantidad||0,2)}</span>
              <span style={{fontSize:10,color:C.textSec,textAlign:"right"}}>{MXN(c.pu||0)}</span>
              <span style={{fontSize:11,fontWeight:600,color:C.caliza,textAlign:"right"}}>{MXN(c.importe||0)}</span>
              <span style={{fontSize:11,fontWeight:600,color:(c.avance||0)>=100?C.green:C.blue,textAlign:"right"}}>{NUM(c.avance||0,0)}%</span>
              <span></span>
            </>)}
          </div>
          {(c.avance||0) > 0 && <div style={{marginTop:6}}>
            <Bar pct={c.avance||0} color={(c.avance||0)>=100?C.green:C.blue}/>
          </div>}
        </div>
      ))}
    </Card>}

    {/* FOTOS POR CONCEPTO */}
    {subtab==="fotos" && <Card>
      <Tit>Fotografías por concepto</Tit>
      <div style={{fontSize:9,color:C.textMut,marginTop:-6,marginBottom:10}}>
        Histórico de avance fotográfico de cada concepto
      </div>
      {sub.conceptos.length === 0 && (
        <div style={{padding:20,textAlign:"center",color:C.textMut,fontSize:11}}>
          Agrega conceptos en el catálogo primero para poder cargar fotos.
        </div>
      )}
      {sub.conceptos.map((c,i)=>{
        const fotos = c.fotos || [];
        return <div key={c.id||i} style={{marginBottom:16,paddingBottom:12,borderBottom:`0.5px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:9,color:C.textMut,fontWeight:600}}>{c.clave||`#${i+1}`}</span>
                <span style={{fontSize:11,fontWeight:600,color:C.caliza}}>{c.desc||"(sin descripción)"}</span>
                <Bdg color={C.blue} small>{fotos.length} foto{fotos.length===1?"":"s"}</Bdg>
              </div>
              <div style={{fontSize:9,color:C.textMut,marginTop:2}}>Avance: {NUM(c.avance||0,0)}%</div>
            </div>
            {editar && <label style={{background:C.caliza,color:C.bg,padding:"4px 10px",borderRadius:6,
              fontSize:10,fontWeight:600,cursor:"pointer",flexShrink:0}}>
              + Foto
              <input type="file" accept="image/*" style={{display:"none"}}
                onChange={e=>{ if(e.target.files?.[0]) subirFotoConcepto(i, e.target.files[0]); e.target.value=""; }}/>
            </label>}
          </div>
          {fotos.length === 0 ? (
            <div style={{padding:14,background:C.bg,borderRadius:6,textAlign:"center",color:C.textMut,fontSize:10}}>
              Sin fotos
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:6}}>
              {fotos.map((f,fi)=>{
                const url = typeof f === "string" ? f : f.url;
                return <div key={fi} style={{position:"relative",aspectRatio:"4/3",borderRadius:6,overflow:"hidden",background:C.bg}}>
                  <img src={url} onClick={()=>setLightbox(url)}
                    style={{width:"100%",height:"100%",objectFit:"cover",cursor:"pointer",display:"block"}}/>
                  {f.fecha && <div style={{position:"absolute",bottom:0,left:0,right:0,
                    background:"linear-gradient(transparent,rgba(0,0,0,0.6))",color:"#fff",
                    fontSize:8,padding:"4px 6px"}}>{f.fecha}</div>}
                  {editar && <button onClick={()=>eliminarFotoConcepto(i, fi)}
                    style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,0.6)",
                      border:"none",color:"#fff",borderRadius:99,width:20,height:20,fontSize:11,cursor:"pointer"}}>×</button>}
                </div>;
              })}
            </div>
          )}
        </div>;
      })}
    </Card>}

    {/* PAGOS AL SUBCONTRATISTA */}
    {subtab==="pagos" && <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {/* Resumen */}
      <Card>
        <Tit>Resumen de pagos al subcontratista</Tit>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:7,marginTop:8}}>
          <Kpi label="Monto contrato" value={MXN(montoContrato)}                                  color={C.caliza}    size={12}/>
          <Kpi label="Pagado"         value={MXN(totalPagado)}     sub={`${NUM(pctFinanciero,1)}% del contrato`} color={C.greenDk}   size={12}/>
          <Kpi label="Programado"     value={MXN(totalProgramado)} sub="pendiente de pago"                  color={C.yellowDk} size={12}/>
          <Kpi label="Por pagar"      value={MXN(Math.max(montoContrato - totalPagado, 0))} sub="saldo del contrato" color={C.blueDk} size={12}/>
        </div>
        <div style={{marginTop:10}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.textMut,marginBottom:3}}>
            <span>Avance financiero</span>
            <span style={{color:C.greenDk,fontWeight:600}}>{NUM(pctFinanciero,1)}%</span>
          </div>
          <Bar pct={pctFinanciero} color={pctFinanciero>=100?C.green:C.greenDk}/>
        </div>
        {/* Alerta de desfase obra vs pago */}
        {sub.conceptos.length > 0 && Math.abs(pctAvance - pctFinanciero) > 10 && (
          <div style={{background:`${C.yellow}15`,border:`0.5px solid ${C.yellow}55`,borderRadius:6,
            padding:"7px 11px",marginTop:10,fontSize:10,color:C.yellowDk}}>
            ⚠ Desfase entre avance físico ({NUM(pctAvance,1)}%) y financiero ({NUM(pctFinanciero,1)}%) de {NUM(Math.abs(pctAvance-pctFinanciero),1)}pp.
            {pctAvance > pctFinanciero ? " El subcontratista lleva más obra ejecutada que pagos recibidos." : " Se le ha pagado más de lo que ha ejecutado."}
          </div>
        )}
      </Card>

      {/* Lista de pagos */}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <Tit>Historial de pagos</Tit>
          {editar && <SecBtn onClick={agregarPago}>+ Pago</SecBtn>}
        </div>
        {pagos.length === 0 && (
          <div style={{padding:20,textAlign:"center",color:C.textMut,fontSize:11}}>
            {editar?'Sin pagos registrados. Click "+ Pago" para empezar.':'Sin pagos registrados.'}
          </div>
        )}
        {/* Header */}
        {pagos.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"110px 130px 1fr 110px 30px",gap:6,
            padding:"4px 10px",marginBottom:4,fontSize:9,color:C.textMut,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>
            <div>Fecha</div><div>Monto</div><div>Referencia / Concepto</div><div>Estatus</div><div></div>
          </div>
        )}
        {pagos.map((p,i)=>{
          const estCol = p.estatus==="pagado"?C.green : p.estatus==="cancelado"?C.red : C.yellow;
          return <div key={p.id||i} style={{display:"grid",gridTemplateColumns:"110px 130px 1fr 110px 30px",gap:6,
            padding:"7px 10px",marginBottom:5,background:C.bg,borderRadius:8,alignItems:"center",
            borderLeft:`3px solid ${estCol}`,opacity:p.estatus==="cancelado"?0.5:1}}>
            {editar ? (<>
              <Inp type="date" value={p.fecha||""} style={{fontSize:10}}
                onChange={e=>actualizarPago(i,{fecha:e.target.value})}/>
              <Inp type="number" value={p.monto||0} style={{fontSize:11,fontWeight:600}}
                onChange={e=>actualizarPago(i,{monto:parseFloat(e.target.value)||0})}/>
              <Inp type="text" value={p.referencia||""} placeholder="Folio, cheque, concepto..." style={{fontSize:10}}
                onChange={e=>actualizarPago(i,{referencia:e.target.value})}/>
              <Sel value={p.estatus||"programado"} style={{fontSize:10,padding:"4px 6px"}}
                onChange={e=>actualizarPago(i,{estatus:e.target.value})}>
                <option value="programado">Programado</option>
                <option value="pagado">Pagado</option>
                <option value="cancelado">Cancelado</option>
              </Sel>
              <button onClick={()=>eliminarPago(i)} style={{background:"none",border:"none",
                color:C.red,fontSize:14,cursor:"pointer"}}>×</button>
            </>) : (<>
              <span style={{fontSize:11,color:C.textSec}}>{p.fecha||"—"}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.caliza}}>{MXN(p.monto||0)}</span>
              <span style={{fontSize:10,color:C.textSec}}>{p.referencia||"—"}</span>
              <Bdg color={estCol} small>{(p.estatus||"programado").toUpperCase()}</Bdg>
              <span></span>
            </>)}
          </div>;
        })}
      </Card>
    </div>}

    {/* Lightbox */}
    {lightbox && <div onClick={()=>setLightbox(null)}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:300,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20,cursor:"pointer"}}>
      <img src={lightbox} style={{maxWidth:"95%",maxHeight:"95%",objectFit:"contain"}}/>
    </div>}
  </div>;
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
    const datos = {
      nombre:obra.nombre, contrato:obra.contrato, cliente:obra.cliente,
      superintendente:obra.superintendente, residente:obra.residente,
      admin:obra.admin, inicio:obra.inicio, fin:obra.fin,
      finAmpliado:obra.finAmpliado||"", presupuesto:obra.presupuesto,
      diasPago: obra.diasPago||30,
    };
    await fsSetA(`obras/${obra.id}/config/info`, datos,
      { modulo:"contrato", entidad:"datos generales", obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
    // También escribir top-level para que la obra sea listable en getDocs(collection('obras'))
    await fsSet(`obras/${obra.id}`, {id: obra.id, ...datos, estado: obra.estado || 'activa'});
    setSaving(false); setSaved(true);
    setTimeout(()=>setSaved(false), 2500);
  }

  // Agregar ampliación
  async function agregarAmpliacion() {
    if(!nuevaAmp.fecha||!nuevaAmp.justificacion) return;
    const amp = {...nuevaAmp, id: Date.now(), fechaRegistro: new Date().toISOString()};
    const nuevo = [...ampliaciones, amp];
    setAmpliaciones(nuevo);
    await fsSetA(`obras/${obra.id}/contrato/plazos`, {ampliaciones: nuevo},
      { modulo:"contrato", entidad:`ampliación ${amp.fecha}`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
    // Actualizar finAmpliado en la obra
    setObra({...obra, finAmpliado: nuevaAmp.fecha});
    setNuevaAmp({fecha:"", justificacion:"", autorizadoPor:""});
    setShowAddAmp(false);
  }

  async function eliminarAmpliacion(id) {
    const nuevo = ampliaciones.filter(a=>a.id!==id);
    setAmpliaciones(nuevo);
    await fsSetA(`obras/${obra.id}/contrato/plazos`, {ampliaciones: nuevo},
      { modulo:"contrato", entidad:"eliminar ampliación", obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
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
        await fsSetA(`obras/${obra.id}/contrato/documentos`, {lista: nuevos},
          { modulo:"contrato", entidad:`documento ${file.name}`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
      } catch(e) { console.error(e); }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  async function eliminarDoc(id) {
    const docPrev = docs.find(d=>d.id===id);
    const nuevo = docs.filter(d=>d.id!==id);
    setDocs(nuevo);
    await fsSetA(`obras/${obra.id}/contrato/documentos`, {lista: nuevo},
      { modulo:"contrato", entidad:`eliminar documento ${docPrev?.nombre||id}`, obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
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
              ["Presupuesto total (SIN IVA)","presupuesto","number"],
              ["Días de pago según contrato","diasPago","number"],
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

// MENÚ PRINCIPAL: 4 tabs por rol (la organización fina vive dentro de cada uno)
// - Dashboard: vista ejecutiva consolidada
// - Operación: lo que se reporta semana a semana (avance, almacén, maq, nómina, estimaciones, subs)
// - Planeación: contrato y presupuesto (lo que define la obra)
// - Gastos GP: datos del Sheet
const TABS_POR_ROL = {
  director_general:    [{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  director_operaciones:[{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  gerente_construccion:[{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  superintendente:     [{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  residente:           [{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  administrador_obra:  [{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  admin_sistema:       [{id:"dash",label:"Dashboard"},{id:"operacion",label:"Operación"},{id:"gastos",label:"Gastos"},{id:"planeacion",label:"Planeación"}],
  cliente:             [{id:"avance_cliente",label:"Avance"},{id:"fotos_cliente",label:"Fotos"},{id:"estimaciones_cliente",label:"Estimaciones"},{id:"plazos_cliente",label:"Plazos"}],
};

// SUB-TABS dentro de cada sección principal
const SUBTABS_OPERACION = [
  {id:"resumen", label:"Resumen"},
  {id:"avance", label:"Avance físico"},
  {id:"almacen", label:"Almacén"},
  {id:"maquinaria", label:"Maquinaria"},
  {id:"nomina", label:"Nómina"},
  {id:"estimaciones", label:"Estimaciones"},
  {id:"subcontratos", label:"Subcontratos"},
];

const SUBTABS_PLANEACION = [
  {id:"contrato", label:"Contrato"},
  {id:"presupuesto", label:"Presupuesto"},
  {id:"permisos", label:"Permisos"},
];

// Sin estimaciones de muestra. Cada obra comienza en blanco.
const EST_DEFAULT = [];

// ── WELCOME BANNER ────────────────────────────────────────────────────────
// Pasos personalizados por rol, basados en el manual operativo. Solo
// aparece la primera vez que el usuario entra a CAMPO.
const PASOS_BIENVENIDA = {
  director_general: [
    { t:"Visión global", d:"Desde la pantalla de Obras ves el portafolio completo: avance, gasto y riesgo de cada obra activa." },
    { t:"Entra a cualquier obra", d:"Haz clic en una obra para ver Dashboard, Operación, Gastos y Planeación con el detalle." },
    { t:"Panel ejecutivo", d:"En Dashboard encuentras KPIs consolidados y alertas en rojo cuando algo requiere tu atención." },
  ],
  director_operaciones: [
    { t:"Crea o abre una obra", d:"En Obras puedes registrar una nueva o entrar a una existente desde GP Construct." },
    { t:"Carga el contrato", d:"En Planeación → Contrato registra cliente, monto, fechas y porcentajes." },
    { t:"Sube el presupuesto", d:"En Planeación → Presupuesto carga el Excel de Opus para activar la captura de avance." },
    { t:"Asigna el equipo", d:"Da de alta a residentes y superintendentes para que entren a capturar avance." },
  ],
  gerente_construccion: [
    { t:"Revisa el portafolio", d:"En Obras ves todas tus obras activas con su semáforo de avance y riesgo." },
    { t:"Captura semanal", d:"En Operación → Avance físico actualiza % por partida cada lunes." },
    { t:"Estimaciones", d:"En Operación → Estimaciones autoriza lo cobrado al cliente." },
  ],
  superintendente: [
    { t:"Tu obra", d:"Entras directo a la obra que tienes asignada. Verás el Dashboard con el avance acumulado." },
    { t:"Captura tu avance", d:"En Operación → Avance físico actualiza el % de cada partida y sube fotos de evidencia." },
    { t:"Maquinaria y almacén", d:"Lleva el control diario de horas-máquina y consumos en Operación → Maquinaria / Almacén." },
    { t:"Semáforo", d:"El Dashboard usa colores: verde si vas bien, amarillo y rojo si hay que ajustar." },
    { t:"Marca riesgos", d:"Si algo se atrasa o tienes un imprevisto, captúralo en Riesgos para que se vea arriba." },
  ],
  residente: [
    { t:"Tu obra", d:"Al entrar verás tu obra preconfigurada. No necesitas crear nada." },
    { t:"Cada lunes", d:"En Operación → Avance físico actualiza el porcentaje de cada partida que avanzaste la semana." },
    { t:"Fotos de evidencia", d:"En cada partida puedes adjuntar fotos. Es la base del reporte fotográfico semanal." },
    { t:"Semáforo", d:"El Dashboard te muestra en verde si vas bien, en amarillo/rojo si hay que ajustar." },
    { t:"Reporta lo crítico", d:"Si algo no avanza o hay un problema, anótalo. Tu superintendente y el gerente lo verán." },
  ],
  administrador_obra: [
    { t:"Tu obra", d:"Tu obra ya está cargada. Entra y revisa el Dashboard para ver el estado actual." },
    { t:"Carga estimaciones", d:"En Operación → Estimaciones registra cada cobro al cliente con su factura." },
    { t:"Gastos y subcontratos", d:"Lleva el control de gastos en Gastos y subcontratos en Operación → Subcontratos." },
    { t:"Semáforo", d:"El Dashboard usa colores: verde si vas bien, amarillo y rojo si hay que ajustar." },
    { t:"Cierra la semana", d:"Cada viernes revisa que toda la captura esté completa antes del corte semanal." },
  ],
  admin_sistema: [
    { t:"Administrador de Sistema", d:"Tienes acceso a todas las obras en modo lectura para soporte técnico." },
    { t:"Usuarios", d:"Puedes dar de alta o desactivar usuarios desde la pantalla de Administración." },
  ],
  cliente: [
    { t:"Tu obra", d:"Aquí ves el avance físico, fotos, estimaciones y plazos de tu obra en tiempo real." },
    { t:"Avance y fotos", d:"En las pestañas Avance y Fotos sigues el progreso semana por semana." },
  ],
};

function WelcomeBanner({usuario, onCerrar}){
  const pasos = PASOS_BIENVENIDA[usuario.rol] || PASOS_BIENVENIDA.administrador_obra;
  const rolLabel = ROL_LABEL[usuario.rol] || "Usuario";
  const primerNombre = (usuario.nombre || "").split(" ")[0] || usuario.nombre || "";
  const [guardando, setGuardando] = useState(false);

  async function cerrar(){
    setGuardando(true);
    try {
      if (usuario.emailId) {
        await fsSet(`usuarios/${usuario.emailId}`, { bienvenidaVista: true });
      }
    } catch(e) { console.error("WelcomeBanner save", e); }
    onCerrar();
  }

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9999,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:C.card,borderRadius:14,maxWidth:540,width:"100%",
      maxHeight:"90vh",overflow:"auto",boxShadow:"0 10px 40px rgba(0,0,0,0.3)"}}>
      <div style={{background:C.caliza,color:"#fff",padding:"18px 22px",borderRadius:"14px 14px 0 0"}}>
        <div style={{fontSize:11,opacity:0.7,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>
          Bienvenido a CAMPO
        </div>
        <div style={{fontSize:20,fontWeight:600,lineHeight:1.3}}>
          Hola {primerNombre}
        </div>
        <div style={{fontSize:12,opacity:0.8,marginTop:4}}>
          Acceso como {rolLabel}
        </div>
      </div>
      <div style={{padding:"18px 22px"}}>
        <div style={{fontSize:12,color:C.textSec,marginBottom:14,lineHeight:1.5}}>
          Para que empieces rápido, estos son los pasos clave de tu rol:
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {pasos.map((p,i)=>(
            <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start"}}>
              <div style={{flexShrink:0,width:26,height:26,borderRadius:"50%",
                background:C.blueDk,color:"#fff",display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:12,fontWeight:600}}>{i+1}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.textPri,marginBottom:2}}>{p.t}</div>
                <div style={{fontSize:12,color:C.textSec,lineHeight:1.45}}>{p.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{marginTop:18,padding:"10px 12px",background:C.bg,borderRadius:8,
          fontSize:11,color:C.textMut,lineHeight:1.4}}>
          Puedes revisar el manual completo en cualquier momento o pedirle ayuda a tu administrador. Este mensaje solo aparece una vez.
        </div>
        <button onClick={cerrar} disabled={guardando} style={{marginTop:16,width:"100%",
          background:C.blueDk,color:"#fff",border:"none",borderRadius:8,padding:"12px",
          fontSize:13,fontWeight:600,cursor:guardando?"wait":"pointer",
          opacity:guardando?0.7:1}}>
          {guardando ? "Guardando…" : "Entendido, empezar"}
        </button>
      </div>
    </div>
  </div>;
}

// ── VISOR DE BITÁCORA (AUDIT LOG) ─────────────────────────────────────────
// Pantalla accesible para director_general / director_operaciones / admin_sistema
const TIPO_LABEL = {
  login:"Inicio sesión", logout:"Cierre sesión",
  crear:"Creación", editar:"Edición", borrar:"Borrado",
};
const TIPO_COLOR = {
  login:C.blueDk, logout:C.textMut,
  crear:C.greenDk, editar:C.yellowDk, borrar:C.redDk,
};
function fmtFechaBit(iso){
  if(!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("es-MX",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});
}
function Bitacora({obras}){
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [fUsuario, setFUsuario] = useState("");
  const [fObra, setFObra] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fModulo, setFModulo] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [detalle, setDetalle] = useState(null);
  const [maxItems, setMaxItems] = useState(200);

  useEffect(()=>{
    let cancel=false;
    (async ()=>{
      setCargando(true); setError("");
      try {
        const q = query(collection(fbDb,"auditoria"), orderBy("ts","desc"), limit(maxItems));
        const snap = await getDocs(q);
        const arr = snap.docs.map(d=>({id:d.id, ...d.data()}));
        if(!cancel){ setItems(arr); setCargando(false); }
      } catch(e) {
        if(!cancel){ setError(e.message || "Error al leer bitácora"); setCargando(false); }
      }
    })();
    return ()=>{cancel=true;};
  },[maxItems]);

  const filtrados = items.filter(it => {
    if(fUsuario && !(it.usuario||"").toLowerCase().includes(fUsuario.toLowerCase())
       && !(it.nombre||"").toLowerCase().includes(fUsuario.toLowerCase())) return false;
    if(fObra && it.obraId !== fObra) return false;
    if(fTipo && it.tipo !== fTipo) return false;
    if(fModulo && it.modulo !== fModulo) return false;
    if(fDesde && it.ts < fDesde) return false;
    if(fHasta && it.ts > fHasta + "T23:59:59") return false;
    return true;
  });

  const modulos = [...new Set(items.map(i=>i.modulo).filter(Boolean))].sort();

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div>
        <h2 style={{fontSize:16,fontWeight:600,color:C.textPri,margin:0}}>Bitácora del sistema</h2>
        <div style={{fontSize:11,color:C.textMut,marginTop:2}}>
          {cargando ? "Cargando…" : `${filtrados.length} de ${items.length} registros`}
        </div>
      </div>
      <select value={maxItems} onChange={e=>setMaxItems(Number(e.target.value))}
        style={{fontSize:11,padding:"4px 8px",border:`1px solid ${C.border}`,borderRadius:6}}>
        <option value={100}>Últimos 100</option>
        <option value={200}>Últimos 200</option>
        <option value={500}>Últimos 500</option>
        <option value={1000}>Últimos 1000</option>
      </select>
    </div>

    {error && <div style={{background:C.redBg,color:C.redDk,padding:10,borderRadius:6,marginBottom:10,fontSize:12}}>
      {error}
    </div>}

    <Card style={{marginBottom:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Usuario</div>
          <input type="text" value={fUsuario} onChange={e=>setFUsuario(e.target.value)}
            placeholder="correo o nombre"
            style={{width:"100%",fontSize:11,padding:"5px 7px",border:`1px solid ${C.border}`,borderRadius:5}}/>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Obra</div>
          <select value={fObra} onChange={e=>setFObra(e.target.value)}
            style={{width:"100%",fontSize:11,padding:"5px 7px",border:`1px solid ${C.border}`,borderRadius:5}}>
            <option value="">Todas</option>
            {obras.map(o=><option key={o.id} value={o.id}>{o.contrato||o.nombre||o.id}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Tipo</div>
          <select value={fTipo} onChange={e=>setFTipo(e.target.value)}
            style={{width:"100%",fontSize:11,padding:"5px 7px",border:`1px solid ${C.border}`,borderRadius:5}}>
            <option value="">Todos</option>
            {Object.keys(TIPO_LABEL).map(k=><option key={k} value={k}>{TIPO_LABEL[k]}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Módulo</div>
          <select value={fModulo} onChange={e=>setFModulo(e.target.value)}
            style={{width:"100%",fontSize:11,padding:"5px 7px",border:`1px solid ${C.border}`,borderRadius:5}}>
            <option value="">Todos</option>
            {modulos.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Desde</div>
          <input type="date" value={fDesde} onChange={e=>setFDesde(e.target.value)}
            style={{width:"100%",fontSize:11,padding:"5px 7px",border:`1px solid ${C.border}`,borderRadius:5}}/>
        </div>
        <div>
          <div style={{fontSize:9,color:C.textMut,marginBottom:3}}>Hasta</div>
          <input type="date" value={fHasta} onChange={e=>setFHasta(e.target.value)}
            style={{width:"100%",fontSize:11,padding:"5px 7px",border:`1px solid ${C.border}`,borderRadius:5}}/>
        </div>
      </div>
    </Card>

    <Card>
      {cargando ? (
        <div style={{padding:30,textAlign:"center",color:C.textMut,fontSize:12}}>Cargando bitácora…</div>
      ) : filtrados.length === 0 ? (
        <div style={{padding:30,textAlign:"center",color:C.textMut,fontSize:12}}>
          {items.length === 0 ? "No hay registros aún." : "Ningún registro coincide con los filtros."}
        </div>
      ) : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${C.border}`,color:C.textMut,fontSize:10,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                <th style={{textAlign:"left",padding:"6px 8px"}}>Fecha</th>
                <th style={{textAlign:"left",padding:"6px 8px"}}>Usuario</th>
                <th style={{textAlign:"left",padding:"6px 8px"}}>Tipo</th>
                <th style={{textAlign:"left",padding:"6px 8px"}}>Módulo</th>
                <th style={{textAlign:"left",padding:"6px 8px"}}>Obra</th>
                <th style={{textAlign:"left",padding:"6px 8px"}}>Entidad</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(it=>(
                <tr key={it.id} style={{borderBottom:`1px solid ${C.bg}`}}>
                  <td style={{padding:"6px 8px",whiteSpace:"nowrap",color:C.textSec}}>{fmtFechaBit(it.ts)}</td>
                  <td style={{padding:"6px 8px"}}>
                    <div style={{color:C.textPri,fontWeight:500}}>{it.nombre || it.usuario}</div>
                    <div style={{color:C.textMut,fontSize:9}}>{it.rol}</div>
                  </td>
                  <td style={{padding:"6px 8px"}}>
                    <span style={{background:(TIPO_COLOR[it.tipo]||C.textMut)+"22",
                      color:TIPO_COLOR[it.tipo]||C.textMut,padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:500}}>
                      {TIPO_LABEL[it.tipo]||it.tipo}
                    </span>
                  </td>
                  <td style={{padding:"6px 8px",color:C.textSec}}>{it.modulo||"—"}</td>
                  <td style={{padding:"6px 8px",color:C.textSec,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.obraNombre||"—"}</td>
                  <td style={{padding:"6px 8px",color:C.textSec,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.entidad||"—"}</td>
                  <td style={{padding:"6px 8px"}}>
                    {(it.antes || it.despues || it.meta) && (
                      <button onClick={()=>setDetalle(it)} style={{background:"none",border:`1px solid ${C.border}`,
                        borderRadius:4,padding:"2px 7px",fontSize:10,color:C.blueDk,cursor:"pointer"}}>Ver</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    {detalle && <div onClick={()=>setDetalle(null)} style={{position:"fixed",inset:0,
      background:"rgba(0,0,0,0.55)",zIndex:9999,display:"flex",alignItems:"center",
      justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:12,
        maxWidth:700,width:"100%",maxHeight:"90vh",overflow:"auto"}}>
        <div style={{background:C.caliza,color:"#fff",padding:"14px 18px",borderRadius:"12px 12px 0 0"}}>
          <div style={{fontSize:11,opacity:0.7}}>{TIPO_LABEL[detalle.tipo]||detalle.tipo} · {detalle.modulo}</div>
          <div style={{fontSize:15,fontWeight:600,marginTop:2}}>{detalle.entidad||detalle.path||""}</div>
          <div style={{fontSize:10,opacity:0.8,marginTop:4}}>
            {detalle.nombre||detalle.usuario} ({detalle.rol}) · {fmtFechaBit(detalle.ts)}
          </div>
          {detalle.obraNombre && <div style={{fontSize:10,opacity:0.7,marginTop:2}}>Obra: {detalle.obraNombre}</div>}
        </div>
        <div style={{padding:"14px 18px"}}>
          {detalle.path && <div style={{fontSize:10,color:C.textMut,marginBottom:8,fontFamily:"monospace"}}>
            {detalle.path}
          </div>}
          {detalle.meta && <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textPri,marginBottom:4}}>Resumen</div>
            <pre style={{background:C.bg,padding:8,borderRadius:6,fontSize:10,overflow:"auto",margin:0}}>
              {JSON.stringify(detalle.meta, null, 2)}
            </pre>
          </div>}
          {detalle.antes !== undefined && <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:600,color:C.redDk,marginBottom:4}}>Antes</div>
            <pre style={{background:C.redBg,padding:8,borderRadius:6,fontSize:10,overflow:"auto",margin:0,maxHeight:240}}>
              {JSON.stringify(detalle.antes, null, 2)}
            </pre>
          </div>}
          {detalle.despues !== undefined && <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:600,color:C.greenDk,marginBottom:4}}>Después</div>
            <pre style={{background:C.greenBg,padding:8,borderRadius:6,fontSize:10,overflow:"auto",margin:0,maxHeight:240}}>
              {JSON.stringify(detalle.despues, null, 2)}
            </pre>
          </div>}
          <button onClick={()=>setDetalle(null)} style={{width:"100%",background:C.blueDk,
            color:"#fff",border:"none",borderRadius:6,padding:"10px",fontSize:12,fontWeight:500,cursor:"pointer"}}>
            Cerrar
          </button>
        </div>
      </div>
    </div>}
  </div>;
}

// ── MATRIZ DE PERMISOS POR OBRA ──────────────────────────────────────────
// Permite a Director/Director Op./Admin Sistema sobre-escribir los permisos
// del equipo operativo (super/residente/admin_obra) en una obra específica.
const ROLES_OVERRIDE = ["superintendente","residente","administrador_obra"];
const MODULOS_OVERRIDE = [
  {id:"captura",      label:"Avance físico"},
  {id:"gastos",       label:"Gastos"},
  {id:"estimaciones", label:"Estimaciones"},
  {id:"riesgo",       label:"Riesgos"},
];
const ACCIONES_OPCIONES = [
  {v:"editar", l:"Editar"},
  {v:"ver",    l:"Solo ver"},
  {v:null,     l:"Sin acceso"},
];
function PermisosObra({obra, rol}){
  const puedeEditar = ["director_general","director_operaciones","admin_sistema"].includes(rol);
  const [override, setOverride] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(()=>{
    let cancel=false;
    setCargando(true);
    fsGet(`obras/${obra.id}/config/permisos`).then(d=>{
      if(cancel) return;
      setOverride(d?.override || null);
      setCargando(false);
    });
    return ()=>{cancel=true;};
  },[obra.id]);

  const valorActual = (rolKey, mod) => {
    if (override && override[rolKey] && override[rolKey][mod] !== undefined) {
      return override[rolKey][mod];
    }
    return PERMISOS[rolKey]?.[mod] ?? null;
  };
  const esDefault = (rolKey, mod) => {
    return !(override && override[rolKey] && override[rolKey][mod] !== undefined);
  };
  const setValor = (rolKey, mod, valor) => {
    setOverride(prev => {
      const nuevo = JSON.parse(JSON.stringify(prev || {}));
      if (!nuevo[rolKey]) nuevo[rolKey] = {};
      nuevo[rolKey][mod] = valor;
      return nuevo;
    });
  };

  async function guardar(){
    setGuardando(true);
    const data = { override: override || {}, actualizadoEn: new Date().toISOString() };
    const ok = await fsSetA(`obras/${obra.id}/config/permisos`, data,
      { modulo:"permisos", entidad:"matriz por obra", obraId:obra.id, obraNombre:obra.contrato||obra.nombre,
        meta:{ override } });
    if (ok) {
      setPermisosObraOverride(override);
      setSaved(true); setTimeout(()=>setSaved(false), 2500);
    }
    setGuardando(false);
  }

  async function restaurarDefaults(){
    if (!window.confirm("¿Restaurar los permisos por default? Se borrará la matriz personalizada de esta obra.")) return;
    setGuardando(true);
    const ok = await fsDelA(`obras/${obra.id}/config/permisos`,
      { modulo:"permisos", entidad:"restaurar defaults", obraId:obra.id, obraNombre:obra.contrato||obra.nombre });
    if (ok) {
      setOverride(null);
      setPermisosObraOverride(null);
      setSaved(true); setTimeout(()=>setSaved(false), 2500);
    }
    setGuardando(false);
  }

  if (cargando) return <Card><div style={{padding:20,textAlign:"center",color:C.textMut,fontSize:12}}>Cargando permisos…</div></Card>;

  return <div style={{display:"flex",flexDirection:"column",gap:10}}>
    <Card>
      <Tit>Matriz de permisos por obra</Tit>
      <div style={{fontSize:11,color:C.textSec,lineHeight:1.5,marginBottom:12}}>
        Por default, Superintendente, Residente y Administrador de Obra pueden editar todo dentro de esta obra.
        En obras grandes o con equipos más numerosos puedes restringir acciones específicas por rol.
        Los cambios solo aplican a <strong>esta obra</strong>.
        {!puedeEditar && <div style={{marginTop:6,color:C.textMut,fontStyle:"italic"}}>Solo lectura — necesitas rol Director o Admin de Sistema para modificar.</div>}
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`,color:C.textMut,fontSize:10,textTransform:"uppercase",letterSpacing:"0.04em"}}>
              <th style={{textAlign:"left",padding:"8px 6px"}}>Rol</th>
              {MODULOS_OVERRIDE.map(m=>(
                <th key={m.id} style={{textAlign:"left",padding:"8px 6px",minWidth:120}}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES_OVERRIDE.map(rolKey=>(
              <tr key={rolKey} style={{borderBottom:`1px solid ${C.bg}`}}>
                <td style={{padding:"10px 6px",fontWeight:500,color:C.textPri}}>{ROL_LABEL[rolKey]}</td>
                {MODULOS_OVERRIDE.map(m=>{
                  const v = valorActual(rolKey, m.id);
                  const def = esDefault(rolKey, m.id);
                  return <td key={m.id} style={{padding:"6px"}}>
                    <select value={v===null?"null":v}
                      disabled={!puedeEditar || guardando}
                      onChange={e=>{
                        const raw = e.target.value;
                        setValor(rolKey, m.id, raw==="null" ? null : raw);
                      }}
                      style={{width:"100%",fontSize:11,padding:"5px 6px",
                        border:`1px solid ${def ? C.border : C.blueDk}`,
                        borderRadius:5,
                        background: def ? C.surface : C.blueBg,
                        color: v===null ? C.redDk : v==="editar" ? C.greenDk : C.textPri}}>
                      {ACCIONES_OPCIONES.map(op=>(
                        <option key={op.v===null?"null":op.v} value={op.v===null?"null":op.v}>{op.l}</option>
                      ))}
                    </select>
                    {!def && <div style={{fontSize:9,color:C.blueDk,marginTop:2}}>personalizado</div>}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {puedeEditar && <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end",alignItems:"center"}}>
        {saved && <span style={{fontSize:11,color:C.greenDk}}>Guardado</span>}
        <button onClick={restaurarDefaults} disabled={guardando || !override}
          style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
            padding:"7px 14px",fontSize:11,color:C.textSec,cursor:(guardando||!override)?"not-allowed":"pointer",
            opacity:(guardando||!override)?0.5:1}}>
          Restaurar defaults
        </button>
        <button onClick={guardar} disabled={guardando}
          style={{background:C.caliza,border:"none",borderRadius:6,
            padding:"7px 14px",fontSize:11,color:C.bg,cursor:guardando?"wait":"pointer",
            opacity:guardando?0.7:1,fontWeight:500}}>
          {guardando?"Guardando…":"Guardar matriz"}
        </button>
      </div>}
    </Card>
    <Card>
      <Tit>Defaults globales (referencia)</Tit>
      <div style={{fontSize:11,color:C.textMut,marginBottom:8}}>
        Estos son los permisos por default si no hay personalización en la obra:
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",fontSize:10,borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`,color:C.textMut,fontSize:9,textTransform:"uppercase"}}>
              <th style={{textAlign:"left",padding:"4px 6px"}}>Rol</th>
              {MODULOS_OVERRIDE.map(m=>(
                <th key={m.id} style={{textAlign:"left",padding:"4px 6px"}}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES_OVERRIDE.map(rolKey=>(
              <tr key={rolKey} style={{borderBottom:`1px solid ${C.bg}`}}>
                <td style={{padding:"4px 6px",color:C.textSec}}>{ROL_LABEL[rolKey]}</td>
                {MODULOS_OVERRIDE.map(m=>{
                  const v = PERMISOS[rolKey]?.[m.id];
                  return <td key={m.id} style={{padding:"4px 6px",
                    color: v==="editar"?C.greenDk : v==="ver"?C.textSec : C.redDk}}>
                    {v==="editar"?"Editar" : v==="ver"?"Solo ver" : "Sin acceso"}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  </div>;
}

export default function App(){
  const[usuario,setUsuario]=useState(null);
  const[mostrarBienvenida,setMostrarBienvenida]=useState(false);
  const[screen,setScreen]=useState("obras");
  const[obraId,setObraId]=useState(null);
  const[tab,setTab]=useState("dash");
  // Sub-tabs activos dentro de Operación y Planeación
  const[subTabOper,setSubTabOper]=useState("resumen");
  const[subTabPlan,setSubTabPlan]=useState("contrato");
  // Helper: navegación desde Dashboard. Si pasa subTab, lo activa también.
  const navTab = (tabId, subTabId) => {
    setTab(tabId);
    if (tabId === "operacion" && subTabId) setSubTabOper(subTabId);
    if (tabId === "planeacion" && subTabId) setSubTabPlan(subTabId);
  };
  const[obras,setObras]=useState(()=>{try{return loadObras();}catch{return _OBRAS_BASE.map(o=>({...o}));}});
  const[cambiosPendientes,setCambiosPendientes]=useState(false);
  const { gpData, gpLoading, gpError, gpUltActualiz, cargarGP, cargarDetalleObra, gpDetalles } = useGPConstruct();

  // Al entrar a una obra, RESETEAR todo a vacío primero (evita ver datos de la obra
  // anterior) y luego cargar lo que haya en Firestore. Si Firestore no tiene datos,
  // los componentes muestran "vacío" hasta que el usuario capture.
  useEffect(()=>{
    if(!obraId) return;
    // Reset inmediato para evitar mostrar datos de la obra anterior
    setSubs([]);
    setMaquinaria([]);
    setMateriales([]);
    setEstimaciones([]);
    setEstCargadas(false);
    setSubcontratos([]);
    setHistorialAvance([]);
    setHistorialCargado(false);
    setOtrosGastos([]);
    setFechasModulos({});

    // Cargar datos reales de Firestore (si existen)
    fsGet(`obras/${obraId}/config/parametros`).then(d=>{
      if(d) setObras(oo=>oo.map(o=>o.id===obraId?{...o,...d}:o));
    });
    // Carga de subs con fallback al catálogo (para obras que cargaron catálogo
    // antes del fix que sincroniza catálogo → subs automáticamente)
    fsGet(`obras/${obraId}/avance/subs`).then(async d=>{
      if(d && Array.isArray(d.data) && d.data.length > 0) {
        // AUTO-MIGRACIÓN: subs viejos guardados sin id único. Si alguno no tiene
        // id, le asignamos uno derivado de su posición (índice) que es único.
        // Esto arregla el bug donde modificar una partida modificaba todas las
        // que tenían la misma clave (sec) en distintas zonas de la obra.
        const necesitaMigrar = d.data.some(s => !s.id);
        const subsConId = necesitaMigrar
          ? d.data.map((s, idx) => ({ ...s, id: s.id || `${s.sec || 'C'}__${idx}` }))
          : d.data;
        setSubs(subsConId);
        if (necesitaMigrar) {
          // Guardar la migración para próximas cargas (silencioso)
          fsSet(`obras/${obraId}/avance/subs`, { data: subsConId });
        }
      } else {
        // Sin subs: intentar derivar del catálogo si existe
        const cat = await fsGet(`obras/${obraId}/config/catalogo`);
        if (cat && Array.isArray(cat.conceptos) && cat.conceptos.length > 0) {
          // Si el catálogo tiene info de categorías (parser nuevo), úsala para
          // asignar cada concepto a su categoría padre. Si no, lista plana.
          const subsFromCat = cat.conceptos.map((c, idx) => ({
            id: `${c.clave || c.id || 'C'}__${idx}`,
            sec: c.clave || c.id,
            sub: c.desc || '(sin descripción)',
            imp: c.importe || 0,
            n: 1, a: 0, fotos: {},
            cat: c.cat || null,
            catDesc: c.catDesc || null,
            ruta: c.ruta || [],
          }));
          setSubs(subsFromCat);
          fsSet(`obras/${obraId}/avance/subs`, { data: subsFromCat });
        }
      }
    });
    fsGet(`obras/${obraId}/avance/maquinaria`).then(d=>{
      if(d&&Array.isArray(d.data)) setMaquinaria(d.data);
      if(d?.fecha) setFechasModulos(f => ({...f, maquinaria: d.fecha}));
    });
    fsGet(`obras/${obraId}/avance/materiales`).then(d=>{
      if(d&&Array.isArray(d.data)) setMateriales(d.data);
      if(d?.fecha) setFechasModulos(f => ({...f, materiales: d.fecha}));
    });
    fsGet(`obras/${obraId}/subcontratos/lista`).then(d=>{
      if(d&&Array.isArray(d.items)) setSubcontratos(d.items);
    });
    // Cargar fecha de la última semana de nómina para detectar pendientes
    fsGet(`obras/${obraId}/nomina/historial`).then(d=>{
      const semanas = d?.semanas;
      if (Array.isArray(semanas) && semanas.length > 0) {
        const ultima = semanas[semanas.length - 1];
        // La semana tiene "fecha" como string es-MX, convertir a ISO aproximada
        // o si trae fechaISO usarla. Como fallback, usar fecha actual menos algunos días
        const fechaIso = ultima.fechaISO || (ultima.fecha
          ? new Date(ultima.fecha.split('/').reverse().join('-')).toISOString()
          : null);
        if (fechaIso) setFechasModulos(f => ({...f, nomina: fechaIso}));
      }
    });
  },[obraId]);
  // Datos por obra: TODOS vacíos por defecto. Se llenan al cargar Firestore
  // (cuando se entra a una obra) o cuando el usuario captura desde el módulo.
  const[subs,setSubs]=useState([]);
  const[maquinaria,setMaquinaria]=useState([]);
  const[materiales,setMateriales]=useState([]);
  const[estimaciones,setEstimaciones]=useState([]);
  const[estCargadas,setEstCargadas]=useState(false);
  const[subcontratos,setSubcontratos]=useState([]);
  const[historialAvance,setHistorialAvance]=useState([]);  // [{id, semana, año, tipo, subs, avancePonderado, ...}]
  const[historialCargado,setHistorialCargado]=useState(false);
  const[otrosGastos,setOtrosGastos]=useState([]);  // gastos manuales fuera de GP
  // Fechas de última actualización por módulo, para detectar pendientes de captura
  const[fechasModulos,setFechasModulos]=useState({});  // {maquinaria:isoDate, materiales:isoDate, nomina:isoDate}

  // Lazy load de historial de avance: se carga al abrir Dashboard o Avance físico
  // (Dashboard lo usa para tendencias mensuales; Avance lo usa para histórico semanal)
  useEffect(() => {
    if (!obraId || historialCargado) return;
    const necesario = (tab === "dash") || (tab === "operacion" && subTabOper === "avance");
    if (necesario) {
      fsGet(`obras/${obraId}/avance/historial`).then(d=>{
        if(d&&Array.isArray(d.semanas)) setHistorialAvance(d.semanas);
        setHistorialCargado(true);
      });
    }
  }, [obraId, tab, subTabOper, historialCargado]);

  // Cargar otros gastos (manuales) al entrar a la obra para que el Dashboard
  // pueda incluirlos en las tendencias y el resumen de gasto total.
  useEffect(() => {
    if (!obraId) return;
    fsGet(`obras/${obraId}/config/otros_gastos`).then(d => {
      setOtrosGastos(Array.isArray(d?.items) ? d.items : []);
    });
  }, [obraId]);

  // Cargar estimaciones desde Firestore al entrar a una obra
  useEffect(()=>{
    if(!obraId||estCargadas) return;
    fsGet(`obras/${obraId}/config/estimaciones`).then(d=>{
      if(d&&Array.isArray(d.data)) setEstimaciones(d.data);
      setEstCargadas(true);
    });
  },[obraId]);

  // ── CARGAR OBRAS desde Firestore al hacer login ──
  // Las obras viven en colecciones top-level `obras/{id}` con sub-doc /config/info.
  // También unimos info de /config/info que puede tener datos más recientes.
  useEffect(() => {
    if (!usuario) return;
    (async () => {
      try {
        const snap = await getDocs(collection(fbDb, 'obras'));
        const obrasFromDB = snap.docs.map(d => ({id: d.id, ...d.data()}));
        // Para cada obra, si hay un /config/info más completo, mergear (info de Contrato editado)
        await Promise.all(obrasFromDB.map(async (o, idx) => {
          const info = await fsGet(`obras/${o.id}/config/info`);
          if (info) obrasFromDB[idx] = {...o, ...info, id: o.id};
        }));
        // Merge: agregar las de Firestore que no estén ya en state, y mergear datos de las que sí
        setObras(actual => {
          const idsActuales = new Set(actual.map(o => o.id));
          const nuevas = obrasFromDB.filter(o => !idsActuales.has(o.id));
          const actualizadas = actual.map(o => {
            const fromDB = obrasFromDB.find(x => x.id === o.id);
            return fromDB ? {...o, ...fromDB} : o;
          });
          return [...actualizadas, ...nuevas];
        });
      } catch (e) {
        console.error('cargar obras', e);
      }
    })();
  }, [usuario?.uid]);

  // ── NOTIFICACIONES en tiempo real ──
  const[notificaciones,setNotificaciones]=useState([]);
  useEffect(() => {
    if (!usuario?.uid) return;
    const q = query(
      collection(fbDb, `notificaciones/${usuario.uid}/items`),
      orderBy('fecha', 'desc'),
      limit(100)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({id: d.id, ...d.data()}));
      setNotificaciones(items);
      // Auto-archivar las > 30 días
      archivarViejas(usuario.uid, items);
    }, (err) => {
      console.error('listener notif', err);
    });
    return () => unsub();
  }, [usuario?.uid]);

  // ── CARGA BULK LAZY: datos de obras para el Panel Ejecutivo ──
  // Solo se ejecuta cuando: (1) hay usuario, (2) está en pantalla "obras"
  // (donde vive el Panel Ejecutivo), (3) tiene rol que ve el panel.
  // Si está dentro de una sola obra, NO se necesita el bulk.
  const[datosPorObra,setDatosPorObra]=useState({});
  const obrasActivasKey = obras.filter(o=>o.estado!=="archivada").map(o=>o.id).sort().join(",");
  const verPanelEjecutivo = usuario && ["director_general","director_operaciones","gerente_construccion"].includes(usuario.rol);
  useEffect(()=>{
    if(!usuario) return;
    if(screen !== "obras") return;   // solo cargar cuando estoy en la lista de obras
    if(!verPanelEjecutivo) return;   // solo si va a ver el Panel Ejecutivo
    const activas = obras.filter(o=>o.estado!=="archivada");
    if(activas.length<2) return;     // el Panel Ejecutivo solo se muestra con ≥2 obras
    // Si ya tenemos los datos de todas las activas, no recargar
    const yaTodos = activas.every(o => datosPorObra[o.id]);
    if (yaTodos) return;
    Promise.all(activas.map(async(o)=>{
      const [info, subsData, maqData, matData, estData] = await Promise.all([
        fsGet(`obras/${o.id}/config/info`),
        fsGet(`obras/${o.id}/avance/subs`),
        fsGet(`obras/${o.id}/avance/maquinaria`),
        fsGet(`obras/${o.id}/avance/materiales`),
        fsGet(`obras/${o.id}/config/estimaciones`),
      ]);
      let subsFinales = [];
      if(subsData && Array.isArray(subsData.data)) subsFinales = subsData.data;
      return [o.id, {
        info: info || {},
        subs: subsFinales,
        maquinaria: (maqData && Array.isArray(maqData.data)) ? maqData.data : [],
        materiales: (matData && Array.isArray(matData.data)) ? matData.data : [],
        estimaciones: (estData && Array.isArray(estData.data)) ? estData.data : [],
      }];
    })).then(pares => {
      const mapa = Object.fromEntries(pares);
      setDatosPorObra(mapa);
      // Enriquecer obras con info de Firestore
      setObras(oo => oo.map(o => {
        const inf = mapa[o.id]?.info || {};
        return { ...o, ...inf };
      }));
    });
  },[usuario, obrasActivasKey, screen, verPanelEjecutivo]);

  if(!usuario) return <><style>{css}</style><Login onLogin={u=>{
    setUsuario(u);
    if (u.bienvenidaVista !== true) setMostrarBienvenida(true);
  }}/></>;

  const obra=obras.find(o=>o.id===obraId);
  const setObra=u=>setObras(oo=>oo.map(o=>o.id===u.id?u:o));
  const entrar=async id=>{
    setObraId(id);setScreen("obra");
    // Tab inicial = primera tab disponible según rol del usuario
    const primerTab = (TABS_POR_ROL[usuario.rol]||TABS_POR_ROL.director_operaciones)[0]?.id || "dash";
    setTab(primerTab);
    const o = obras.find(x=>x.id===id);
    setAuditObra(id, o?.contrato || o?.nombre || "");
    // Cargar override de permisos por obra (si lo tiene configurado)
    try {
      const perm = await fsGet(`obras/${id}/config/permisos`);
      setPermisosObraOverride(perm?.override || null);
    } catch { setPermisosObraOverride(null); }
    fsAudit("editar", { modulo:"navegacion", entidad:"entrar a obra", obraId:id, obraNombre:o?.contrato||"" });
  };
  const volver=()=>{setScreen("obras");setObraId(null); setAuditObra(null, ""); setPermisosObraOverride(null);};
  const logout=async()=>{
    try { fsAudit("logout", { modulo: "sesion", entidad: usuario?.correo || "" }); } catch {}
    try { await signOut(fbAuth); } catch {}
    setAuditCtx({ correo:"anonimo", nombre:"", rol:"", obraId:null, obraNombre:"" });
    setPermisosObraOverride(null);
    setUsuario(null); setScreen("obras"); setObraId(null);
  };
  const TABS=TABS_POR_ROL[usuario.rol]||TABS_POR_ROL.director_operaciones;

  // ── PENDIENTES DE CAPTURA EN OPERACIÓN ──
  // Cuenta:
  //  - Cierre semanal (si pasó el jueves y no hay snapshot oficial de esta semana)
  //  - Almacén sin captura en últimos 7 días (si ya hay materiales registrados)
  //  - Maquinaria sin captura en últimos 7 días
  //  - Nómina semanal sin cargar (última semana > 7 días)
  const pendientesOp = (() => {
    if (screen !== "obra" || !obra) return 0;
    let count = 0;
    const hoy = new Date();
    const dow = hoy.getDay(); // 0=dom,1=lun...6=sab
    const hace7d = new Date(hoy.getTime() - 7*24*60*60*1000);
    // 1) Cierre semanal pendiente: jueves o después y sin snapshot oficial
    if (dow >= 4 || dow === 0) {
      const { semana, año } = semanaISO(hoy);
      const tieneOficial = (historialAvance||[]).some(s =>
        s.semana === semana && s.año === año && s.tipo === 'oficial');
      if (!tieneOficial) count++;
    }
    // 2) Almacén: solo si ya hay materiales registrados
    if (materiales.length > 0 && fechasModulos.materiales) {
      const f = new Date(fechasModulos.materiales);
      if (!isNaN(f) && f < hace7d) count++;
    }
    // 3) Maquinaria: solo si ya hay equipos registrados
    if (maquinaria.length > 0 && fechasModulos.maquinaria) {
      const f = new Date(fechasModulos.maquinaria);
      if (!isNaN(f) && f < hace7d) count++;
    }
    // 4) Nómina: si la última semana cargada es > 7 días
    if (fechasModulos.nomina) {
      const f = new Date(fechasModulos.nomina);
      if (!isNaN(f) && f < hace7d) count++;
    }
    return count;
  })();

  return <ErrorBoundary><>
    <style>{css}</style>
    {mostrarBienvenida && <WelcomeBanner usuario={usuario} onCerrar={()=>{
      setMostrarBienvenida(false);
      setUsuario(u=>u?{...u,bienvenidaVista:true}:u);
    }}/>}
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
        {/* Campana de notificaciones — para todos los usuarios autenticados */}
        <CentroNotificaciones usuario={usuario} notificaciones={notificaciones}
          onNavTab={(t,st)=>{ setScreen("obra"); navTab(t,st); }}
          onSelectObra={(id)=>{ if(id && id!==obraId) entrar(id); }}/>
        {["director_general","director_operaciones","admin_sistema"].includes(usuario.rol) && (
          <button onClick={()=>setScreen(screen==="usuarios"?"obras":"usuarios")}
            style={{background:screen==="usuarios"?C.caliza:"none",
              border:`0.5px solid ${screen==="usuarios"?C.caliza:C.border}`,borderRadius:6,
              padding:"4px 8px",fontSize:10,
              color:screen==="usuarios"?C.bg:C.textMut,cursor:"pointer",whiteSpace:"nowrap"}}>
            {screen==="usuarios"?"← Obras":"Usuarios"}
          </button>
        )}
        {["director_general","director_operaciones","admin_sistema"].includes(usuario.rol) && (
          <button onClick={()=>setScreen(screen==="bitacora"?"obras":"bitacora")}
            style={{background:screen==="bitacora"?C.caliza:"none",
              border:`0.5px solid ${screen==="bitacora"?C.caliza:C.border}`,borderRadius:6,
              padding:"4px 8px",fontSize:10,
              color:screen==="bitacora"?C.bg:C.textMut,cursor:"pointer",whiteSpace:"nowrap"}}>
            {screen==="bitacora"?"← Obras":"Bitácora"}
          </button>
        )}
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
      {obra&&<button onClick={()=>generarPDFObra(obra,subs,estimaciones,maquinaria,materiales,subcontratos)}
        title="Descargar reporte ejecutivo en PDF"
        style={{background:C.caliza,border:"none",borderRadius:6,
          margin:"4px 12px",padding:"6px 14px",fontSize:11,fontWeight:600,color:"white",cursor:"pointer",
          display:"flex",alignItems:"center",gap:6,letterSpacing:"0.02em"}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <polyline points="9 15 12 12 15 15"/>
        </svg>
        Reporte ejecutivo
      </button>}
    </div>}

    {screen==="obra"&&<div className="noscroll" style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
      display:"flex",overflowX:"auto",padding:"0 12px"}}>
      {TABS.map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",
          borderBottom:`2px solid ${tab===t.id?C.blueDk:"transparent"}`,padding:"8px 12px",fontSize:11,
          color:tab===t.id?C.blueDk:C.textSec,cursor:"pointer",whiteSpace:"nowrap",
          fontWeight:tab===t.id?500:400,letterSpacing:"0.01em",transition:"all .15s",
          display:"inline-flex",alignItems:"center",gap:6}}>
          <span>{t.label}</span>
          {t.id==="operacion" && pendientesOp > 0 && (
            <span title="Capturas pendientes esta semana"
              style={{background:C.red,color:"#fff",fontSize:9,fontWeight:700,
                borderRadius:99,minWidth:16,height:16,padding:"0 5px",
                display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
              {pendientesOp}
            </span>
          )}
        </button>
      ))}
    </div>}

    <div style={{maxWidth:980,margin:"0 auto",padding:"14px 14px 56px"}}>
      {screen==="usuarios"&&<GestionUsuarios usuario={usuario} obras={obras} onClose={()=>setScreen("obras")}/>}
      {screen==="bitacora"&&<Bitacora obras={obras}/>}
      {screen==="obras"&&<PantallaObras onSelect={entrar} usuario={usuario} obras={obras} setObras={setObras} gpData={gpData} gpLoading={gpLoading} gpUltActualiz={gpUltActualiz} onRefreshGP={cargarGP} datosPorObra={datosPorObra}/>}

      {/* DASHBOARD ejecutivo */}
      {screen==="obra"&&tab==="dash"&&obra&&<Dashboard obra={obra} subs={subs} maquinaria={maquinaria} materiales={materiales} estimaciones={estimaciones} subcontratos={subcontratos} historialAvance={historialAvance} gpData={gpData} otrosGastos={otrosGastos} onNavTab={navTab}/>}

      {/* OPERACIÓN: wrapper con sub-tabs */}
      {screen==="obra"&&tab==="operacion"&&obra&&(
        <Operacion
          subTab={subTabOper} setSubTab={setSubTabOper}
          obra={obra} setObra={setObra} rol={usuario.rol} usuario={usuario}
          subs={subs} setSubs={v=>{setSubs(v);setCambiosPendientes(true);}}
          maquinaria={maquinaria} setMaquinaria={v=>{setMaquinaria(v);setCambiosPendientes(true);}}
          materiales={materiales} setMateriales={v=>{setMateriales(v);setCambiosPendientes(true);}}
          estimaciones={estimaciones} setEstimaciones={setEstimaciones}
          subcontratos={subcontratos} setSubcontratos={setSubcontratos}
          historialAvance={historialAvance} setHistorialAvance={setHistorialAvance}
          setCambiosPendientes={setCambiosPendientes}
          onNavTab={navTab}/>
      )}

      {/* GASTOS GP */}
      {screen==="obra"&&tab==="gastos"&&obra&&<GastosGP obra={obra} maquinaria={maquinaria} rol={usuario.rol} gpData={gpData} gpLoading={gpLoading} gpError={gpError} gpUltActualiz={gpUltActualiz} onRefreshGP={cargarGP} cargarDetalleObra={cargarDetalleObra} gpDetalles={gpDetalles}/>}

      {/* PLANEACIÓN: wrapper con sub-tabs Contrato + Presupuesto */}
      {screen==="obra"&&tab==="planeacion"&&obra&&(
        <Planeacion
          subTab={subTabPlan} setSubTab={setSubTabPlan}
          obra={obra} setObra={setObra} rol={usuario.rol}
          setSubsGlobal={setSubs}/>
      )}

      {/* Vistas para rol cliente */}
      {screen==="obra"&&tab==="avance_cliente"&&obra&&<AvanceCliente obra={obra} subs={subs}/>}
      {screen==="obra"&&tab==="fotos_cliente"&&obra&&<FotosCliente obra={obra} subs={subs}/>}
      {screen==="obra"&&tab==="estimaciones_cliente"&&obra&&<EstimacionesCliente obra={obra} estimaciones={estimaciones}/>}
      {screen==="obra"&&tab==="plazos_cliente"&&obra&&<PlazosCliente obra={obra}/>}
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
