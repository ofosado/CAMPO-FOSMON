// ════════════════════════════════════════════════════════════════════════════
// MÓDULO ÓRDENES DE TRABAJO (OT) — TAMSA
// ────────────────────────────────────────────────────────────────────────────
// Permite subir PDF de una Orden de Trabajo SAP (Tenaris) desde el navegador,
// parsearlo con pdfjs-dist, matchear cada línea contra las partidas del
// presupuesto CAMPO y sumar la cantidad ejecutada. Guarda:
//   - PDF original en Storage: obras/{obraId}/ot/{numero}.pdf
//   - Documento en Firestore: obras/{obraId}/ordenes_trabajo/{numero}
//   - Diccionario de equivalencias aprendidas: obras/{obraId}/config/ot_dict
// Formato SAP con coma como decimal ("60,000 M3" = 60 m³).
// ════════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useRef } from "react";
import { doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// ── PDFJS (lazy-load) ───────────────────────────────────────────────────────
// Vite necesita el worker por URL. Usamos import.meta.url para que la ruta
// funcione tanto en dev como en el bundle de producción.
let _pdfjsPromise = null;
async function loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  })();
  return _pdfjsPromise;
}

// ── HELPERS DE FORMATO ──────────────────────────────────────────────────────
// SAP escribe "60,000" como 60 (coma decimal). Si viene punto es decimal
// estilo americano. Nunca ambos en el mismo número en las OT reales.
export function parseNumeroSAP(s) {
  if (typeof s === "number") return s;
  if (!s) return 0;
  const clean = String(s).trim().replace(/\s+/g, "");
  if (clean.includes(",") && !clean.includes(".")) {
    return parseFloat(clean.replace(",", ".")) || 0;
  }
  return parseFloat(clean) || 0;
}

// Normaliza texto para matching: minúsculas, sin acentos, sin puntuación
export function normalizarTextoOT(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Semana ISO (YYYY-Www) a partir de fecha dd.mm.yyyy o Date
export function semanaISO(fechaStr) {
  let d;
  if (fechaStr instanceof Date) d = fechaStr;
  else if (/^\d{2}\.\d{2}\.\d{4}$/.test(fechaStr)) {
    const [dd, mm, yyyy] = fechaStr.split(".");
    d = new Date(+yyyy, +mm - 1, +dd);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(fechaStr)) {
    d = new Date(fechaStr);
  } else {
    d = new Date(fechaStr);
  }
  if (isNaN(d)) return "";
  // ISO week
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ── PARSER PDF DE ORDEN DE TRABAJO ──────────────────────────────────────────
// Extrae metadatos + líneas de servicio de una OT SAP de Tenaris.
// Reto: pdfjs devuelve las letras acentuadas separadas por espacios
// ("Descripci ó n" en vez de "Descripción"). Solución: para cada línea
// producir una versión "normalizada" sin diacríticos y con letras sueltas
// colapsadas, aplicar regex sobre esa, y guardar la original para mostrar.
export async function parseOTPdf(file) {
  const pdfjs = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  // normalizarLinea: quita diacríticos y REPARA las keywords conocidas del PDF
  // SAP que salen fragmentadas por letras tildadas ("Descripci o n" → "Descripcion").
  // Preserva el resto del texto tal cual, para que las descripciones queden
  // legibles y las regex de metadatos encuentren las keywords intactas.
  const normLinea = (s) => {
    let out = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim();
    // Reparar keywords: la letra que era tildada quedó como carácter aislado
    // rodeado de espacios. La palabra puede tener múltiples letras aisladas.
    return out
      .replace(/Descripci\s*o\s*n\b/gi, "Descripcion")
      .replace(/Imputaci\s*o\s*n\b/gi, "Imputacion")
      .replace(/Operaci\s*o\s*n\b/gi, "Operacion")
      .replace(/Ubic\s*\.\s*t\s*e?\s*cnica/gi, "Ubic.tecnica")
      .replace(/N\s*u\s*mero\s+de\s+Servicio/gi, "Numero de Servicio")
      .replace(/Ingenier\s*i\s*a\b/gi, "Ingenieria")
      .replace(/P\s*a\s*gina\b/gi, "Pagina")
      .replace(/selecci\s*o\s*n\b/gi, "seleccion")
      .replace(/DEMOLICI\s*O\s*N\b/gi, "DEMOLICION")
      .replace(/EXCAVACI\s*O\s*N\b/gi, "EXCAVACION")
      .replace(/OPERACI\s*O\s*N\b/gi, "OPERACION")
      .replace(/GR\s*U\s*A/gi, "GRUA")
      .replace(/Telesc\s*o\s*pica/gi, "Telescopica")
      .replace(/mec\s*a\s*n\b/gi, "mecan")
      .replace(/\s+/g, " ").trim();
  };

  // Recolectar líneas: {y, original, norm, normSoft}
  const todasLineas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const buckets = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!buckets.has(y)) buckets.set(y, []);
      buckets.get(y).push({ x: item.transform[4], str: item.str });
    }
    const ys = [...buckets.keys()].sort((a, b) => b - a); // top-down
    for (const y of ys) {
      const original = buckets.get(y).sort((a, b) => a.x - b.x).map(i => i.str).join(" ");
      const orig = original.replace(/\s+/g, " ").trim();
      todasLineas.push({ y, original: orig, norm: normLinea(original) });
    }
  }

  // Texto completo normalizado (para regex de metadatos)
  const textoNorm = todasLineas.map(l => l.norm).join("\n");

  // ── Metadatos con regex sobre textoNorm ───────────────────────────────────
  const meta = {};
  const mNum = textoNorm.match(/Orden\s+(\d{9,15})\s+Clase/i);
  meta.numero = mNum ? mNum[1] : "";
  const mDesc = textoNorm.match(/(?:^|\n)\s*Descripcion\s+(.+?)(?:\n|Aviso)/i);
  meta.descripcion = mDesc ? mDesc[1].trim() : "";
  const mFecha = textoNorm.match(/Inicio\s+(\d{2}\.\d{2}\.\d{4})/i);
  meta.fecha = mFecha ? mFecha[1] : "";
  const mUbic = textoNorm.match(/Ubic\.tecnica\s+(\S+)\s+(.+?)(?:\n|Equipo)/i);
  meta.ubicTecnica = mUbic ? `${mUbic[1]} ${mUbic[2].trim()}` : "";
  meta.ubicTecnicaCod = mUbic ? mUbic[1] : "";
  const mImp = textoNorm.match(/Imputacion\.\s*(P\.[\d.]+)/i);
  meta.imputacion = mImp ? mImp[1] : "";
  const mPto = textoNorm.match(/Pto\s+trab\.resp\.\s+(\S+)/i);
  meta.ptoTrabajo = mPto ? mPto[1] : "";
  const mAct = textoNorm.match(/Actividad\s+de\s+Riesgo\s+en\s+operacion\s+seleccionada\s*\n\s*(\d+\s*-\s*.+?)(?:\n|Operacion)/i);
  meta.actividad = mAct ? mAct[1].trim() : "";

  // ── Líneas de servicio: iterar por líneas ─────────────────────────────────
  // La keyword "Breve" no lleva tilde → la puedo buscar en normSoft y extraer
  // el texto legible que viene después. La "Cantidad" viene en la misma línea
  // o en la siguiente, con formato SAP "n,nnn UNIDAD" (n,nnn = n.nnn europeo).
  const lineas = [];
  for (let i = 0; i < todasLineas.length; i++) {
    const soft = todasLineas[i].norm;
    // "Breve" es keyword atómica, sin tildes → índice fiable
    const idx = soft.search(/\bBreve\b/i);
    if (idx < 0) continue;
    // Texto después de "Breve " es la descripción. Puede terminar en "Cantidad"
    // si toda la línea trae desc+cantidad juntas.
    let descRaw = soft.substring(idx + "Breve".length).trim();
    // Separar si "Cantidad" está en la misma línea
    let mismaLineaCant = descRaw.match(/^(.*?)\s+Cantidad\s+([\d.,]+)\s+([A-Z0-9]{2,5})/i);
    let desc, cant = null, unidad = null;
    if (mismaLineaCant) {
      desc = mismaLineaCant[1].trim();
      cant = parseNumeroSAP(mismaLineaCant[2]);
      unidad = mismaLineaCant[3].toUpperCase();
    } else {
      // Si la descripción termina con "Cantidad" (sin número), la cantidad
      // vino cortada a la siguiente línea. Quitar "Cantidad" del final.
      const acabaEnCantidad = /\s+Cantidad\s*$/i.test(descRaw);
      desc = descRaw.replace(/\s+Cantidad\s*$/i, "").trim();
      // Buscar en las próximas 3 líneas
      for (let j = 1; j <= 3 && (i + j) < todasLineas.length; j++) {
        const next = todasLineas[i + j].norm;
        // Patrón 1: línea con "Cantidad n UNIDAD"
        let mCant = next.match(/Cantidad\s+([\d.,]+)\s+([A-Z0-9]{2,5})/i);
        // Patrón 2: línea que empieza directamente con "n UNIDAD" (continuación)
        if (!mCant && acabaEnCantidad) {
          mCant = next.match(/^\s*([\d.,]+)\s+([A-Z0-9]{2,5})/);
        }
        if (mCant) {
          cant = parseNumeroSAP(mCant[1]);
          unidad = mCant[2].toUpperCase();
          break;
        }
      }
    }
    // Limpiar la descripción de artefactos comunes
    desc = desc.replace(/\s+/g, " ").trim();
    if (desc && cant !== null && cant > 0 && unidad) {
      lineas.push({ descripcion: desc, cantidad: cant, unidad });
    }
  }

  return { meta, lineas, textoRaw: textoNorm };
}

// ── MATCHING PARTIDA ↔ LÍNEA DE OT ──────────────────────────────────────────
// Devuelve { partidaId, score, motivo } o null.
// Estrategia en cascada:
//   1) Diccionario aprendido (descripción normalizada → conceptoId): score 1.0
//   2) Imputación coincidente + fuzzy: score alto
//   3) Fuzzy puro sobre s.sub: score < 1
export function matchOTLineaAPartida(linea, subs, dict = {}, imputacion = "") {
  const key = normalizarTextoOT(linea.descripcion);
  if (!key) return null;

  // 1) Diccionario aprendido
  if (dict[key]) {
    const sub = subs.find(s => s.id === dict[key]);
    if (sub) return { partidaId: sub.id, sub, score: 1.0, motivo: "dict" };
  }

  // Preparar candidatos (con o sin filtro por imputación)
  let candidatos = subs;
  const conMismaImp = imputacion ? subs.filter(s => s.imputacion === imputacion) : [];
  if (conMismaImp.length > 0) candidatos = conMismaImp;

  // 2/3) Fuzzy: dice-coefficient sobre bigrams de descripción
  const bigrams = (s) => {
    const b = new Set();
    for (let i = 0; i < s.length - 1; i++) b.add(s.substr(i, 2));
    return b;
  };
  const dice = (a, b) => {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return (2 * inter) / (a.size + b.size);
  };
  const bA = bigrams(key);
  const puntajes = candidatos.map(s => {
    const bB = bigrams(normalizarTextoOT(s.sub || ""));
    return { sub: s, score: dice(bA, bB) };
  }).sort((a, b) => b.score - a.score);

  const top = puntajes[0];
  if (top && top.score >= 0.30) {
    return {
      partidaId: top.sub.id,
      sub: top.sub,
      score: top.score,
      motivo: conMismaImp.length > 0 ? "imputacion+fuzzy" : "fuzzy",
      alternativos: puntajes.slice(1, 4).filter(p => p.score >= 0.20),
    };
  }

  // Devolver top 3 aunque sean malos para que el usuario elija
  return {
    partidaId: null,
    sub: null,
    score: top?.score || 0,
    motivo: "sin_match",
    alternativos: puntajes.slice(0, 5).filter(p => p.score > 0),
  };
}

// ── ESTILOS COMPARTIDOS (con paleta CAMPO) ──────────────────────────────────
const S = {
  card: {
    background: "#FFFFFF", borderRadius: 10, padding: 14,
    border: "0.5px solid #E1E5EA", marginBottom: 10,
  },
  btn: {
    padding: "8px 14px", fontSize: 12, borderRadius: 8,
    background: "#0D1619", color: "#FFF", border: "none", cursor: "pointer",
    fontWeight: 600,
  },
  btnSec: {
    padding: "8px 14px", fontSize: 12, borderRadius: 8,
    background: "#F0F2F5", color: "#0D1619", border: "0.5px solid #E1E5EA",
    cursor: "pointer", fontWeight: 500,
  },
  input: {
    padding: "6px 8px", fontSize: 12, borderRadius: 6,
    border: "0.5px solid #E1E5EA", background: "#FFF",
  },
  chip: {
    display: "inline-block", padding: "2px 6px", fontSize: 9,
    borderRadius: 4, fontWeight: 600, marginRight: 4,
  },
  th: {
    fontSize: 10, fontWeight: 600, color: "#555E6B", textAlign: "left",
    padding: "6px 8px", borderBottom: "0.5px solid #E1E5EA",
  },
  td: {
    fontSize: 11, padding: "8px", borderBottom: "0.5px solid #F0F2F5",
    verticalAlign: "top",
  },
};

// ── COMPONENTE: CARGA DE OT ─────────────────────────────────────────────────
export function CargarOT({ obra, subs, setSubs, fbDb, fbStor, usuario, onCargada }) {
  const [estado, setEstado] = useState("idle"); // idle | parsing | preview | guardando | ok | error
  const [error, setError] = useState("");
  const [ot, setOt] = useState(null); // { meta, lineas, matches: [{linea, match, conceptoIdSeleccionado}] }
  const [dict, setDict] = useState({});
  const [pdfFile, setPdfFile] = useState(null);
  const fileRef = useRef(null);

  // Cargar diccionario aprendido al montar / al cambiar obra
  useEffect(() => {
    if (!obra?.id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(fbDb, "obras", obra.id, "config", "ot_dict"));
        if (snap.exists()) setDict(snap.data().mapa || {});
      } catch (e) { console.warn("ot_dict load fail", e); }
    })();
  }, [obra?.id]);

  const onFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("El archivo debe ser PDF");
      setEstado("error");
      return;
    }
    setError(""); setEstado("parsing"); setPdfFile(file);
    try {
      const { meta, lineas } = await parseOTPdf(file);
      if (!meta.numero) throw new Error("No pude leer el número de orden. ¿Es una OT de TAMSA?");
      if (lineas.length === 0) throw new Error("No detecté líneas de servicio en el PDF");

      // Duplicado?
      const dupSnap = await getDoc(doc(fbDb, "obras", obra.id, "ordenes_trabajo", meta.numero));
      if (dupSnap.exists()) {
        const d = dupSnap.data();
        const cuando = d.subidoEn ? new Date(d.subidoEn).toLocaleString("es-MX") : "fecha desconocida";
        const quien = d.subidoPorNombre || d.subidoPor || "usuario desconocido";
        throw new Error(`La OT ${meta.numero} ya fue cargada el ${cuando} por ${quien}. No la subo otra vez para evitar duplicar avance.`);
      }

      // Matchear
      const matches = lineas.map(l => {
        const r = matchOTLineaAPartida(l, subs, dict, meta.imputacion);
        return { linea: l, match: r, conceptoIdSeleccionado: r?.partidaId || "" };
      });

      setOt({ meta, lineas, matches });
      setEstado("preview");
    } catch (e) {
      console.error("parseOT", e);
      setError(e.message || "Error al procesar el PDF");
      setEstado("error");
    }
  };

  const cambiarMatch = (idx, conceptoId) => {
    setOt(o => ({
      ...o,
      matches: o.matches.map((m, i) => i === idx ? { ...m, conceptoIdSeleccionado: conceptoId } : m),
    }));
  };

  const guardar = async () => {
    if (!ot) return;
    // Validar que todas las líneas tengan match
    const sinMatch = ot.matches.filter(m => !m.conceptoIdSeleccionado);
    if (sinMatch.length > 0) {
      if (!window.confirm(`${sinMatch.length} línea(s) sin partida asignada. Se van a IGNORAR. ¿Continuar?`)) return;
    }
    setEstado("guardando");
    try {
      // 1) Subir PDF a Storage
      let pdfUrl = "";
      try {
        const r = storageRef(fbStor, `obras/${obra.id}/ot/${ot.meta.numero}.pdf`);
        await uploadBytes(r, pdfFile);
        pdfUrl = await getDownloadURL(r);
      } catch (e) {
        console.warn("PDF upload fail, continuando sin URL", e);
      }

      // 2) Actualizar subs sumando cantidad a cada partida matcheada
      const sumaPorPartida = {}; // conceptoId → cantidad total sumada
      const lineasFinal = ot.matches.map(m => {
        const linea = { ...m.linea, conceptoId: m.conceptoIdSeleccionado || null };
        if (m.conceptoIdSeleccionado) {
          sumaPorPartida[m.conceptoIdSeleccionado] = (sumaPorPartida[m.conceptoIdSeleccionado] || 0) + m.linea.cantidad;
        }
        return linea;
      });
      const subsActualizadas = subs.map(s => {
        const suma = sumaPorPartida[s.id];
        if (!suma) return s;
        const cantEjecPrev = parseFloat(s.cantEjec) || 0;
        const cantEjecNueva = cantEjecPrev + suma;
        const cantCat = parseFloat(s.cant) || 0;
        const pctNuevo = cantCat > 0 ? Math.min(100, cantEjecNueva / cantCat * 100) : (s.a || 0);
        return { ...s, cantEjec: cantEjecNueva, a: pctNuevo };
      });
      setSubs(subsActualizadas);

      // 3) Guardar OT en Firestore
      await setDoc(doc(fbDb, "obras", obra.id, "ordenes_trabajo", ot.meta.numero), {
        numero: ot.meta.numero,
        fecha: ot.meta.fecha,
        semanaISO: semanaISO(ot.meta.fecha),
        descripcion: ot.meta.descripcion,
        ubicTecnica: ot.meta.ubicTecnica,
        imputacion: ot.meta.imputacion,
        ptoTrabajo: ot.meta.ptoTrabajo,
        actividad: ot.meta.actividad,
        lineas: lineasFinal,
        pdfUrl,
        subidoPor: usuario?.email || "",
        subidoPorNombre: usuario?.nombre || usuario?.email || "",
        subidoEn: new Date().toISOString(),
      });

      // 4) Aprender diccionario
      const dictNuevo = { ...dict };
      ot.matches.forEach(m => {
        if (m.conceptoIdSeleccionado) {
          const key = normalizarTextoOT(m.linea.descripcion);
          dictNuevo[key] = m.conceptoIdSeleccionado;
        }
      });
      await setDoc(doc(fbDb, "obras", obra.id, "config", "ot_dict"), { mapa: dictNuevo });
      setDict(dictNuevo);

      setEstado("ok");
      if (onCargada) onCargada();
      setTimeout(() => { setEstado("idle"); setOt(null); setPdfFile(null); }, 2500);
    } catch (e) {
      console.error("guardarOT", e);
      setError(e.message || "Error al guardar");
      setEstado("error");
    }
  };

  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0D1619" }}> Cargar Orden de Trabajo (PDF)</div>
        {estado === "ok" && <span style={{ ...S.chip, background: "#DFF3D2", color: "#3D6717" }}>Cargada</span>}
      </div>

      {estado === "idle" && (
        <>
          <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }}
            onChange={e => onFile(e.target.files?.[0])} />
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
            style={{
              border: "1.5px dashed #B0B7C3", borderRadius: 10, padding: "22px 12px",
              textAlign: "center", cursor: "pointer", color: "#555E6B", fontSize: 12,
              background: "#FAFBFC",
            }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}></div>
            <div>Arrastra o toca aquí para subir la OT en PDF</div>
            <div style={{ fontSize: 10, color: "#8B94A6", marginTop: 3 }}>El sistema detecta partidas y suma cantidades automáticamente.</div>
          </div>
        </>
      )}

      {estado === "parsing" && <div style={{ fontSize: 12, color: "#555E6B", padding: 12 }}>Leyendo PDF…</div>}
      {estado === "guardando" && <div style={{ fontSize: 12, color: "#555E6B", padding: 12 }}>Guardando…</div>}

      {estado === "error" && (
        <div style={{ background: "#FCEBEB", color: "#A32D2D", padding: 10, borderRadius: 6, fontSize: 12 }}>
          {error}
          <div style={{ marginTop: 6 }}>
            <button style={S.btnSec} onClick={() => { setEstado("idle"); setError(""); setOt(null); }}>Volver</button>
          </div>
        </div>
      )}

      {estado === "preview" && ot && (
        <>
          {/* Metadatos */}
          <div style={{ background: "#F0F2F5", padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 11 }}>
            <div><b>OT:</b> {ot.meta.numero} <span style={{ color: "#8B94A6" }}>· {ot.meta.fecha}</span></div>
            <div style={{ marginTop: 3 }}><b>Descripción:</b> {ot.meta.descripcion}</div>
            <div style={{ marginTop: 3 }}>
              <span style={{ color: "#555E6B" }}>Ubic: {ot.meta.ubicTecnica || "—"}</span>
              {ot.meta.imputacion && <span style={{ marginLeft: 12, color: "#555E6B" }}>Imputación: {ot.meta.imputacion}</span>}
            </div>
          </div>

          {/* Tabla de líneas con matching */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={S.th}>Línea de la OT</th>
                  <th style={S.th}>Cantidad</th>
                  <th style={S.th}>Partida sugerida</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {ot.matches.map((m, i) => {
                  const alts = m.match?.alternativos || [];
                  return (
                    <tr key={i}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 500 }}>{m.linea.descripcion}</div>
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <b>{m.linea.cantidad.toLocaleString("es-MX", { maximumFractionDigits: 3 })}</b> {m.linea.unidad}
                      </td>
                      <td style={S.td}>
                        <select value={m.conceptoIdSeleccionado} onChange={e => cambiarMatch(i, e.target.value)}
                          style={{ ...S.input, width: "100%", maxWidth: 320 }}>
                          <option value="">— Ignorar esta línea —</option>
                          {m.match?.sub && (
                            <option value={m.match.sub.id}>
                              [{m.match.sub.sec}] {m.match.sub.sub} ({m.match.sub.unidad || "—"})
                            </option>
                          )}
                          {alts.map(a => (
                            <option key={a.sub.id} value={a.sub.id}>
                              [{a.sub.sec}] {a.sub.sub} ({a.sub.unidad || "—"})
                            </option>
                          ))}
                          <option disabled>──────</option>
                          {subs
                            .filter(s => s.id !== m.match?.sub?.id && !alts.find(a => a.sub.id === s.id))
                            .filter(s => (s.imp || 0) > 0)
                            .map(s => (
                              <option key={s.id} value={s.id}>
                                [{s.sec}] {s.sub} ({s.unidad || "—"})
                              </option>
                            ))}
                        </select>
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        {m.conceptoIdSeleccionado ? (
                          m.match?.motivo === "dict"
                            ? <span style={{ ...S.chip, background: "#DFF3D2", color: "#3D6717" }}>Auto ✓</span>
                            : m.match?.score >= 0.5
                              ? <span style={{ ...S.chip, background: "#E6F1FB", color: "#185FA5" }}>{Math.round((m.match.score || 0) * 100)}%</span>
                              : <span style={{ ...S.chip, background: "#FAEEDA", color: "#854F0B" }}>Verificar</span>
                        ) : (
                          <span style={{ ...S.chip, background: "#FCEBEB", color: "#A32D2D" }}>Sin match</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button style={S.btnSec} onClick={() => { setEstado("idle"); setOt(null); setPdfFile(null); }}>Cancelar</button>
            <button style={S.btn} onClick={guardar}>Confirmar y sumar avance</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── COMPONENTE: HISTÓRICO DE OT (tabla pivote partida × semana) ─────────────
export function HistoricoOT({ obra, subs, setSubs, fbDb }) {
  const [ots, setOts] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [expandida, setExpandida] = useState(null);

  useEffect(() => {
    if (!obra?.id) return;
    (async () => {
      setCargando(true);
      try {
        const snap = await getDocs(collection(fbDb, "obras", obra.id, "ordenes_trabajo"));
        const arr = snap.docs.map(d => d.data());
        arr.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
        setOts(arr);
      } catch (e) { console.error("hist OT", e); }
      setCargando(false);
    })();
  }, [obra?.id]);

  // Construir pivote: filas = partidas ejecutadas, columnas = semanas ISO ordenadas
  const { filas, semanas } = useMemo(() => {
    const semanasSet = new Set();
    const porPartida = new Map(); // conceptoId → { partidaSub, celdas: {semana: cantidad}, total }
    ots.forEach(ot => {
      const semana = ot.semanaISO || semanaISO(ot.fecha);
      if (semana) semanasSet.add(semana);
      (ot.lineas || []).forEach(l => {
        if (!l.conceptoId) return;
        const sub = subs.find(s => s.id === l.conceptoId);
        if (!sub) return;
        if (!porPartida.has(l.conceptoId)) {
          porPartida.set(l.conceptoId, { sub, celdas: {}, total: 0, unidad: l.unidad || sub.unidad });
        }
        const fila = porPartida.get(l.conceptoId);
        fila.celdas[semana] = (fila.celdas[semana] || 0) + l.cantidad;
        fila.total += l.cantidad;
      });
    });
    const semanas = [...semanasSet].sort();
    const filas = [...porPartida.values()].sort((a, b) => (a.sub.sec || "").localeCompare(b.sub.sec || ""));
    return { filas, semanas };
  }, [ots, subs]);

  const eliminarOT = async (ot) => {
    // Calcular impacto antes de confirmar: cuánto se resta y de qué partidas
    const sumaPorPartida = {}; // conceptoId → cantidad a restar
    (ot.lineas || []).forEach(l => {
      if (!l.conceptoId) return;
      sumaPorPartida[l.conceptoId] = (sumaPorPartida[l.conceptoId] || 0) + (l.cantidad || 0);
    });
    const partidasAfectadas = Object.entries(sumaPorPartida).map(([cid, cant]) => {
      const sub = subs.find(s => s.id === cid);
      return { sub, cant, cid };
    }).filter(x => x.sub);

    // Detectar si alguna restaría por debajo de 0 (queda en 0 con aviso)
    const aClamp = partidasAfectadas.filter(x => (parseFloat(x.sub.cantEjec) || 0) < x.cant);

    let mensaje = `Eliminar OT ${ot.numero}?\n\n`;
    if (partidasAfectadas.length > 0) {
      mensaje += `Se van a RESTAR las siguientes cantidades del avance:\n\n`;
      partidasAfectadas.forEach(x => {
        mensaje += `  · [${x.sub.sec}] ${x.sub.sub}: -${x.cant} ${x.sub.unidad || ""}\n`;
      });
      if (aClamp.length > 0) {
        mensaje += `\n${aClamp.length} partida(s) quedarían negativas y se ajustarán a 0. Revisa después si algún avance manual quedó por encima.`;
      }
    } else {
      mensaje += `Esta OT no tiene partidas asignadas. Solo se elimina el registro.`;
    }
    mensaje += `\n\n¿Continuar?`;

    if (!window.confirm(mensaje)) return;

    try {
      // 1) Restar cantidades y recalcular %
      if (partidasAfectadas.length > 0 && setSubs) {
        setSubs(prev => prev.map(s => {
          const restar = sumaPorPartida[s.id];
          if (!restar) return s;
          const cantEjecPrev = parseFloat(s.cantEjec) || 0;
          const cantEjecNueva = Math.max(0, cantEjecPrev - restar);
          const cantCat = parseFloat(s.cant) || 0;
          const pctNuevo = cantCat > 0 ? Math.min(100, cantEjecNueva / cantCat * 100) : (s.a || 0);
          return { ...s, cantEjec: cantEjecNueva, a: pctNuevo };
        }));
      }
      // 2) Borrar el documento de la OT
      await deleteDoc(doc(fbDb, "obras", obra.id, "ordenes_trabajo", ot.numero));
      // 3) Quitarla del estado local
      setOts(prev => prev.filter(o => o.numero !== ot.numero));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  if (cargando) return <div style={{ ...S.card, fontSize: 12, color: "#555E6B" }}>Cargando histórico…</div>;
  if (ots.length === 0) return null;

  return (
    <div style={S.card}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0D1619", marginBottom: 10 }}>
         Histórico de OT — {ots.length} orden{ots.length !== 1 ? "es" : ""}
      </div>

      {/* Tabla pivote */}
      {filas.length > 0 && semanas.length > 0 && (
        <div style={{ overflowX: "auto", marginBottom: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ ...S.th, position: "sticky", left: 0, background: "#FFF", zIndex: 1, minWidth: 220 }}>Partida</th>
                {semanas.map(s => <th key={s} style={{ ...S.th, textAlign: "right", whiteSpace: "nowrap" }}>{s}</th>)}
                <th style={{ ...S.th, textAlign: "right", background: "#F0F2F5" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.sub.id}>
                  <td style={{ ...S.td, position: "sticky", left: 0, background: "#FFF" }}>
                    <div style={{ fontSize: 9, color: "#0D1619", fontWeight: 700 }}>{f.sub.sec}</div>
                    <div style={{ fontSize: 10, color: "#555E6B" }}>{f.sub.sub}</div>
                    <div style={{ fontSize: 9, color: "#8B94A6" }}>({f.unidad})</div>
                  </td>
                  {semanas.map(s => (
                    <td key={s} style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {f.celdas[s] ? f.celdas[s].toLocaleString("es-MX", { maximumFractionDigits: 3 }) : "—"}
                    </td>
                  ))}
                  <td style={{ ...S.td, textAlign: "right", background: "#F0F2F5", fontWeight: 700 }}>
                    {f.total.toLocaleString("es-MX", { maximumFractionDigits: 3 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lista de OT (colapsable con detalle) */}
      <div style={{ fontSize: 11, fontWeight: 600, color: "#555E6B", marginBottom: 6 }}>Órdenes cargadas</div>
      {ots.map(ot => (
        <div key={ot.numero} style={{ background: "#F0F2F5", borderRadius: 6, padding: "6px 10px", marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => setExpandida(expandida === ot.numero ? null : ot.numero)}>
            <div style={{ fontSize: 11 }}>
              <b>{ot.numero}</b> <span style={{ color: "#8B94A6" }}>· {ot.fecha}</span>
              <span style={{ marginLeft: 8, color: "#555E6B" }}>{ot.descripcion}</span>
            </div>
            <div style={{ fontSize: 10, color: "#8B94A6" }}>
              {(ot.lineas || []).length} línea(s)
            </div>
          </div>
          {expandida === ot.numero && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "0.5px solid #E1E5EA" }}>
              {(ot.lineas || []).map((l, i) => {
                const sub = subs.find(s => s.id === l.conceptoId);
                return (
                  <div key={i} style={{ fontSize: 10, padding: "3px 0", color: "#0D1619" }}>
                    · {l.descripcion} → <b>{l.cantidad}</b> {l.unidad}
                    {sub ? <span style={{ color: "#3D6717" }}> → [{sub.sec}] {sub.sub}</span>
                         : <span style={{ color: "#A32D2D" }}> → sin partida</span>}
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {ot.pdfUrl && (
                  <a href={ot.pdfUrl} target="_blank" rel="noreferrer" style={{ ...S.btnSec, textDecoration: "none", display: "inline-block" }}>
                    Ver PDF
                  </a>
                )}
                <button style={{ ...S.btnSec, color: "#A32D2D" }} onClick={() => eliminarOT(ot)}>Eliminar OT</button>
              </div>
              <div style={{ fontSize: 9, color: "#8B94A6", marginTop: 6 }}>
                Subida por {ot.subidoPorNombre || ot.subidoPor || "—"} · {ot.subidoEn ? new Date(ot.subidoEn).toLocaleString("es-MX") : ""}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
