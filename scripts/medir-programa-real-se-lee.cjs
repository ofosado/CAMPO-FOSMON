#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿LA APP LEE EL PROGRAMA DE VERDAD? — PENDIENTES #51
// ════════════════════════════════════════════════════════════════════════════
//
// Los bancos de `parsearPrograma` corren contra hojas FABRICADAS con la forma
// de las de verdad. Eso es lo correcto para un banco —una prueba que dependa
// de un archivo que no está en el repositorio no puede correr en la suite—,
// pero deja una pregunta abierta que ninguna aserción puede contestar: si las
// hojas fabricadas son fieles.
//
// Esto la contesta. Toma los anexos reales de producción, los convierte a la
// MISMA forma que `XLSX.utils.sheet_to_json(ws, {header:1, defval:null})` le
// entrega al navegador, y les pasa el `parsearPrograma` extraído de
// `src/App.jsx`. Lo que sale es lo que vería Omar en la pantalla.
//
// Por qué la conversión va en Python y no con SheetJS: SheetJS se carga desde
// un CDN en el navegador y no está en `node_modules`, así que aquí no hay.
// `scripts/medir-programas-de-obra.py` ya lee xlsx con la librería estándar
// —un xlsx es un zip de XML— y esa lectura ya quedó verificada contra dos
// anclas del propio archivo. Reusar ese lector es preferible a traer una
// dependencia nueva para una medición.
//
// LOS ARCHIVOS NO ESTÁN EN EL REPOSITORIO, a propósito: son datos de obra de
// clientes. Viven en `~/Desarrollo/CAMPO-datos-produccion/programas`.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   node scripts/medir-programa-real-se-lee.cjs
//
// Salida: 0 si los tres se leen · 1 si alguno se rechaza o sale sin meses.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { deApp } = require('./extraer-de-app.cjs');

const DIR = process.env.DIR_PROGRAMAS ||
  path.join(os.homedir(), 'Desarrollo', 'CAMPO-datos-produccion', 'programas');

// `obra.inicio` del sistema, para el caso del DE-5, que no declara arranque en
// el archivo. Es el `inicio` que la obra 0126 tiene cargado en producción:
// 2026-05-07, en `obras/0126` y en `obras/0126/config/info`, los dos sin tocar
// desde el 2026-05-22.
//
// CORREGIDO el 2026-11-04. Aquí decía `2026-02-16`, y el comentario afirmaba
// que salía de medir producción. No salía de ahí —producción no ha dicho eso
// nunca— así que era una cifra tecleada con un respaldo falso encima, que es
// peor que una cifra sin respaldo: nadie la vuelve a comprobar. Se descubrió
// midiendo las cinco obras para el #96 (cuadrar el alta contra su anexo).
//
// No es inofensivo: de este arranque sale la separación de la Cangrejera
// contra la recta, y esa cifra está citada en tres sitios del repositorio. Con
// el arranque corregido hay que volver a medirla y corregirlos.
const ARRANQUE_DEL_SISTEMA = { '0126': '2026-05-07' };
const MAPA = [
  ['AE11 PROGRAMA GENERAL MONTOS EMISOR.xlsx', '0131', 'el emisor'],
  ['AE11 PROGRAMA GENERAL MONTOS COLECTOR.xlsx', '0128', 'el colector'],
  ['DE-5 PROGRAMA GENERAL ECONOMICO-ESTRUCTURAS Y LAMINAS.xlsx', '0126', 'la Cangrejera'],
];

const { parsearPrograma, pctProgramadoEnFecha, programaConArranque, mesesDelPrograma } =
  deApp('parsearPrograma', 'pctProgramadoEnFecha', 'programaConArranque', 'mesesDelPrograma');

// ── La hoja, con la forma que le llega al navegador ────────────────────────
//
// `defval: null` en las celdas vacías INTERMEDIAS; las de la cola se quedan
// fuera, que es lo que hace SheetJS —las filas salen desiguales—. Las fechas
// salen como SERIAL de Excel, sin convertir, igual que con `{raw:true}`, que
// es el modo por omisión: es el parser de la app el que las interpreta, y si
// aquí se convirtieran no se estaría midiendo eso.
const PY = `
import json, sys, zipfile, xml.etree.ElementTree as ET
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
comp = []
try:
    sst = ET.fromstring(z.read('xl/sharedStrings.xml'))
    for si in sst.findall(NS + 'si'):
        comp.append(''.join(t.text or '' for t in si.iter(NS + 't')))
except KeyError:
    pass
hoja = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
def col(ref):
    n = 0
    for ch in ref:
        if ch.isalpha(): n = n * 26 + (ord(ch.upper()) - 64)
        else: break
    return n - 1
filas = []
for row in hoja.iter(NS + 'row'):
    celdas = {}
    for c in row.findall(NS + 'c'):
        j = col(c.get('r', 'A1'))
        v = c.find(NS + 'v'); t = c.get('t')
        if t == 's' and v is not None and v.text is not None:
            celdas[j] = comp[int(v.text)]
        elif t == 'inlineStr':
            isn = c.find(NS + 'is')
            celdas[j] = ''.join(x.text or '' for x in isn.iter(NS + 't')) if isn is not None else None
        elif v is not None and v.text is not None:
            try: celdas[j] = float(v.text)
            except ValueError: celdas[j] = v.text
    if not celdas:
        filas.append([]); continue
    ancho = max(celdas) + 1
    filas.append([celdas.get(j) for j in range(ancho)])
json.dump(filas, sys.stdout)
`;

const hojaDe = (archivo) => {
  const r = spawnSync('python3', ['-c', PY, archivo], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`python3 no pudo leer ${path.basename(archivo)}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

const MXN = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });

if (!fs.existsSync(DIR)) {
  console.error(`No está ${DIR}. Los programas no viven en el repositorio (son datos de cliente).`);
  process.exit(1);
}

let malos = 0;
console.log('¿LA APP LEE EL PROGRAMA DE VERDAD? · #51\n');

for (const [archivo, oid, apodo] of MAPA) {
  const ruta = path.join(DIR, archivo);
  console.log('─'.repeat(74));
  console.log(`${apodo} (${oid}) · ${archivo}`);
  if (!fs.existsSync(ruta)) {
    console.log('   falta el archivo — no se midió'); malos++; continue;
  }
  let res;
  try { res = parsearPrograma(hojaDe(ruta)); }
  catch (e) { console.log(`   el parser REVENTÓ: ${e.message}`); malos++; continue; }

  if (!res.ok) {
    console.log(`   RECHAZADO: ${res.porQue}`);
    malos++; continue;
  }
  const prog = programaConArranque(res, { inicio: ARRANQUE_DEL_SISTEMA[oid] || null });
  console.log(`   encabezado en el renglón ${res.filaEncabezado} · ${res.meses} meses · ` +
    `${res.partidas.length} partidas`);
  console.log(`   total de los meses: ${MXN(res.total)}` +
    (res.totalDeclarado !== null ? ` · el archivo declara ${MXN(res.totalDeclarado)}` : ''));
  console.log(`   arranque ${res.inicio || '(no lo trae)'} → fin ${res.fin || '(no lo trae)'}` +
    (prog?.inicioHeredado ? `  ·  se heredó ${prog.inicio} de la obra` : ''));
  for (const a of res.avisos) console.log(`   aviso: ${a}`);

  // ── LA CIFRA DEL PENDIENTE, Y EL ERROR QUE ESTA MEDICIÓN CORRIGIÓ ───────
  //
  // La primera versión comparaba el programa contra la recta A MITAD DEL
  // PLAZO. Los números reales la tumbaron: en el colector salían 0.3 puntos de
  // diferencia y en la Cangrejera 1.1, o sea «la recta estaba bien». No lo
  // está — es que una curva S CRUZA la recta por el centro por construcción,
  // así que el punto medio es justo el peor sitio para medir la separación.
  //
  // Lo que se mide es el MÁXIMO a lo largo del plazo, día por día, y se dice
  // en qué fecha ocurre. Ésa es la cifra que importa para una estimación,
  // porque una estimación se corta cualquier día, no el día de en medio.
  const meses = mesesDelPrograma(prog?.inicio, prog?.meses);
  if (!prog || !meses.length) {
    console.log('   NO SE PUDO FECHAR: sin arranque, un programa mensual no se puede leer');
    malos++; continue;
  }
  const ini = new Date(prog.inicio + 'T00:00:00');
  const [aF, mF] = meses[meses.length - 1];
  const finP = new Date(aF, mF, 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dias = Math.round((finP - ini) / 86400000);
  let peor = null; let mitad = null;
  for (let k = 0; k <= dias; k++) {
    const f = iso(new Date(ini.getTime() + k * 86400000));
    const p = pctProgramadoEnFecha(prog, f);
    if (p === null) continue;
    const recta = (k / dias) * 100;
    const sep = p - recta;
    if (!peor || Math.abs(sep) > Math.abs(peor.sep)) peor = { f, p, recta, sep };
    if (k === Math.round(dias / 2)) mitad = { f, p, recta };
  }
  if (!peor) { console.log('   el por ciento programado salió null siempre'); malos++; continue; }
  console.log(`   separación MÁXIMA contra la recta: ${peor.sep > 0 ? '+' : ''}${peor.sep.toFixed(1)} puntos ` +
    `el ${peor.f} (programa ${peor.p.toFixed(1)}% · recta ${peor.recta.toFixed(1)}%)`);
  if (mitad) {
    console.log(`   y a mitad del plazo sólo ${(mitad.p - mitad.recta >= 0 ? '+' : '')}` +
      `${(mitad.p - mitad.recta).toFixed(1)}: la curva S cruza la recta por el centro, ` +
      `así que medir ahí esconde el defecto`);
  }
  if (res.partidas.length === 0 || res.meses < 2) {
    console.log('   sospechoso: se leyó, pero sin partidas o con menos de dos meses');
    malos++;
  }
}

console.log('─'.repeat(74));
if (malos) {
  console.log(`${malos} de ${MAPA.length} programas reales NO los lee la app.`);
  process.exit(1);
}
console.log(`Los ${MAPA.length} programas reales los lee la app tal como vienen.`);
process.exit(0);
