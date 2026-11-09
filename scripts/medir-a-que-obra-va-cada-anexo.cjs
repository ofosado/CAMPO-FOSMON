#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿A QUÉ OBRA VIVA CORRESPONDE CADA ANEXO? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. Antes de escribir un programa de obra en producción hay que saber en
// cuál. Cargarlo en la obra equivocada NO DA ERROR: da una curva programada que
// se ve medida y es de otro contrato. Es el mismo accidente que el `ENumProy`
// de GP, y la única defensa es medir la correspondencia en vez de suponerla.
//
// `scripts/medir-programa-real-se-lee.cjs` ya trae un `MAPA` que dice qué
// archivo va a qué obra. Ese mapa está TECLEADO: alguien lo escribió mirando el
// nombre del archivo. Este guion no lo usa ni lo lee. Empareja por el MONTO del
// anexo contra el presupuesto de cada obra, y luego corrobora con plazo,
// cliente y lugar. Si el emparejamiento por monto coincide con el mapa, el mapa
// queda respaldado; si no, el mapa está mal y hay que saberlo antes de escribir.
//
// EL MONTO ES EL ANCLA, no el nombre, por dos razones: lo declara el propio
// archivo contractual y es el único dato que la obra tiene cargado con el que
// se puede comparar al centavo. Lo que NO se puede usar es el número de
// contrato: el sistema casi no lo guarda, y eso también sale medido aquí.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()`, y hace
// GET. No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`. Una bandera se
// puede teclear mal; un verbo que no está escrito no se puede mandar.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   export TOKEN=$(gcloud auth application-default print-access-token)
//   node scripts/medir-a-que-obra-va-cada-anexo.cjs --prod
//
// Salida: 0 si los tres anexos tienen una obra y UNA SOLA · 1 si alguno queda
// sin obra, con más de una, o con el monto descuadrado.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolverDestino } = require('./destino.cjs');
const { deApp } = require('./extraer-de-app.cjs');

const DESTINO = resolverDestino({ soloLectura: true });
const PROYECTO = process.env.GCLOUD_PROJECT || 'campo-fosmon';
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC, y hay que EXPORTARLO —una asignación');
  console.error('suelta en una cadena de `&&` no llega al proceso de node:\n');
  console.error('  export TOKEN=$(gcloud auth application-default print-access-token)');
  console.error('  node scripts/medir-a-que-obra-va-cada-anexo.cjs --prod\n');
  process.exit(2);
}

async function leer(ruta) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'GET',
    headers: DESTINO.prod
      ? { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO }
      : { Authorization: 'Bearer owner' },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    console.error(`\nNO ARRANCÓ: HTTP ${r.status} en ${ruta}`);
    console.error((await r.text()).slice(0, 300));
    process.exit(2);
  }
  return r.json();
}

const txt = (f, k) => f?.[k]?.stringValue ?? null;
const num = (f, k) => {
  const v = f?.[k];
  if (!v) return null;
  return v.integerValue !== undefined ? Number(v.integerValue)
       : v.doubleValue !== undefined ? v.doubleValue : null;
};

const DIR = process.env.DIR_PROGRAMAS ||
  path.join(os.homedir(), 'Desarrollo', 'CAMPO-datos-produccion', 'programas');

// El lector de xlsx es el mismo que ya usa `medir-programa-real-se-lee.cjs`, y
// por el mismo motivo: SheetJS se carga de un CDN en el navegador y no está en
// `node_modules`. Un xlsx es un zip de XML y la librería estándar de Python lo
// abre sin traer dependencia nueva para una medición.
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

// El serial de Excel a ISO. 25569 es el 1970-01-01 en la cuenta de Excel, que
// arranca el 1899-12-30 por el bisiesto de 1900 que nunca existió.
const serialISO = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 20000 || n > 70000) return null;
  const d = new Date(Math.round((n - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// La identificación que el archivo trae ENCIMA del encabezado de partidas: lo
// que el documento dice de sí mismo, sin interpretarlo.
const identidadDe = (filas) => {
  const id = { emisor: null, cliente: null, concurso: null, obra: null,
               lugar: null, duracion: null, inicio: null, fin: null };
  const limpiar = (v) => String(v == null ? '' : v).replace(/_x000D_/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const f = filas[i] || [];
    if (i === 0 && f[0]) id.emisor = limpiar(f[0]);
    for (let j = 0; j < f.length; j++) {
      const c = limpiar(f[j]).toLowerCase().replace(/[:.]/g, '').trim();
      const sig = f[j + 1];
      if (sig == null) continue;
      if (c === 'cliente' && !id.cliente) id.cliente = limpiar(sig);
      if (c === 'concurso no' && !id.concurso) id.concurso = limpiar(sig);
      if (c === 'obra' && !id.obra) id.obra = limpiar(sig);
      if (c === 'lugar' && !id.lugar) id.lugar = limpiar(sig);
      if (c === 'duración' && !id.duracion) id.duracion = limpiar(sig);
      if (c === 'inicio obra' && !id.inicio) id.inicio = serialISO(sig);
      if (c === 'fin obra' && !id.fin) id.fin = serialISO(sig);
    }
  }
  return id;
};

const MXN = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dias = (a, b) => (a && b) ? Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000) : null;
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

const { parsearPrograma } = deApp('parsearPrograma');

(async () => {
  if (!fs.existsSync(DIR)) {
    console.error(`No está ${DIR}. Los anexos no viven en el repositorio (son datos de cliente).`);
    process.exit(1);
  }
  const archivos = fs.readdirSync(DIR).filter(f => /\.xlsx$/i.test(f) && !/^~\$/.test(f)).sort();
  if (!archivos.length) { console.error(`No hay .xlsx en ${DIR}.`); process.exit(1); }

  // ── Las obras vivas, de producción ────────────────────────────────────────
  const lista = await leer('obras?pageSize=300');
  const obras = [];
  for (const d of (lista?.documents || [])) {
    const f = d.fields || {};
    const id = d.name.split('/').pop();
    if ((txt(f, 'estado') || 'activa') === 'archivada') continue;
    obras.push({
      id, nombre: txt(f, 'nombre'), cliente: txt(f, 'cliente'),
      contrato: txt(f, 'contrato'), presupuesto: num(f, 'presupuesto'),
      inicio: txt(f, 'inicio'), fin: txt(f, 'fin'),
      yaTienePrograma: !!(await leer(`obras/${id}/config/programa`)),
    });
  }

  console.log(`A QUÉ OBRA VA CADA ANEXO · ${DESTINO.prod ? 'PRODUCCIÓN' : 'emulador'}\n`);
  console.log(`Obras vivas: ${obras.length}\n`);
  console.log('clave  presupuesto             contrato en el sistema   programa');
  console.log('─'.repeat(78));
  for (const o of obras) {
    console.log(`${o.id.padEnd(6)} ${MXN(o.presupuesto).padStart(21)}   ` +
      `${(o.contrato || '(no trae campo)').padEnd(22)}  ${o.yaTienePrograma ? 'cargado' : '—'}`);
  }

  // EL CAMPO `contrato` NO ES UN NÚMERO DE CONTRATO, y eso se mide, no se
  // supone. En unas obras trae un folio («6700388901») y en otras trae pegada
  // la DESCRIPCIÓN LEGAL de la obra, que es un párrafo. Las dos cosas sirven
  // —la descripción incluso mejor, porque es literal— pero no sirven igual, así
  // que se cuentan por separado en vez de llamarlas a todas «contrato».
  // EL FOLIO Y LA DESCRIPCIÓN NO SON EXCLUYENTES, y clasificarlos como si lo
  // fueran fue un error mío que esta medición ya cazó: la 0126 guarda
  // `5200011871 "Rehabilitación de estructuras..."`, o sea las dos cosas en el
  // mismo campo. Tratarla como «folio» la sacaba del cruce por descripción y el
  // guion reportaba que el DE-5 contradecía al monto, cuando lo que pasaba era
  // que su obra no estaba ni en la comparación. Así que se PARTE el campo.
  const vivo = (o) => o.contrato && norm(o.contrato) !== 'N/A';
  const folioDe = (s) => (String(s || '').match(/^\s*(\d{6,})/) || [])[1] || null;
  const descDe = (s) => {
    const t = String(s || '').replace(/^\s*\d{6,}\s*/, '')
      .replace(/^[“"'«\s]+/, '').replace(/[”"'»\s]+$/, '').trim();
    return t.length >= 20 ? t : null;
  };
  const vivas = obras.filter(vivo);
  const conFolio = vivas.filter(o => folioDe(o.contrato));
  const conDescripcion = vivas.filter(o => descDe(o.contrato));
  console.log('');
  console.log(`El campo «contrato» de las ${obras.length} obras vivas:`);
  console.log(`   ${conFolio.length} traen un FOLIO` +
    (conFolio.length ? `: ${conFolio.map(o => `${o.id} ${folioDe(o.contrato)}`).join(', ')}` : ''));
  console.log(`   ${conDescripcion.length} traen la DESCRIPCIÓN LEGAL de la obra` +
    (conDescripcion.length ? `: ${conDescripcion.map(o => o.id).join(', ')}` : ''));
  console.log(`   ${obras.length - vivas.length} no traen nada` +
    `, y ${vivas.filter(o => folioDe(o.contrato) && descDe(o.contrato)).map(o => o.id).join(', ') || '(ninguna)'} traen las dos`);
  console.log('');
  console.log('El «Concurso No» del anexo es el folio del CONCURSO, no del contrato, y');
  console.log('no está en ninguna obra: no empareja nada. Así que el ancla es el MONTO,');
  console.log('y la DESCRIPCIÓN LEGAL se usa como segundo cruce independiente.');

  let malos = 0;
  for (const archivo of archivos) {
    console.log('');
    console.log('═'.repeat(78));
    console.log(archivo);
    let filas, res;
    try { filas = hojaDe(path.join(DIR, archivo)); res = parsearPrograma(filas); }
    catch (e) { console.log(`   el lector o el parser REVENTÓ: ${e.message}`); malos++; continue; }
    if (!res.ok) { console.log(`   el parser lo RECHAZA: ${res.porQue}`); malos++; continue; }

    const id = identidadDe(filas);
    const plazoArchivo = dias(res.inicio, res.fin);
    console.log(`   lo emite        ${id.emisor || '(no lo dice)'}`);
    console.log(`   cliente         ${id.cliente || '(no lo dice)'}`);
    console.log(`   concurso no     ${id.concurso || '(no lo dice)'}`);
    console.log(`   obra            ${(id.obra || '(no lo dice)').slice(0, 68)}`);
    console.log(`   lugar           ${id.lugar || '(no lo dice)'}`);
    console.log(`   plazo           ${id.duracion || '(no lo dice)'}` +
      `${res.inicio ? ` · ${res.inicio} → ${res.fin || '?'}` : ' · el archivo no declara arranque'}` +
      `${plazoArchivo !== null ? ` (${plazoArchivo} d)` : ''}`);
    console.log(`   MONTO           ${MXN(res.total)} sumando los meses` +
      (res.totalDeclarado !== null ? ` · el archivo declara ${MXN(res.totalDeclarado)}` : ''));
    console.log(`                   ${res.partidas.length} partidas · ${res.meses} meses`);

    // ── EL EMPAREJAMIENTO. Al centavo primero; si no, al peso ───────────────
    const alCentavo = obras.filter(o => o.presupuesto !== null &&
      Math.abs(o.presupuesto - res.total) < 0.005);
    const alPeso = obras.filter(o => o.presupuesto !== null &&
      Math.abs(o.presupuesto - res.total) < 1 && !alCentavo.includes(o));
    const candidatas = alCentavo.length ? alCentavo : alPeso;

    console.log('');
    if (candidatas.length === 0) {
      // NINGUNA COINCIDE: se dice la más cercana y CUÁNTO se descuadra, que es
      // lo que hay que discutir antes de escribir. Un convenio modificatorio
      // explica una diferencia; un anexo de otro contrato también.
      const cerca = obras.filter(o => o.presupuesto !== null)
        .sort((a, b) => Math.abs(a.presupuesto - res.total) - Math.abs(b.presupuesto - res.total))[0];
      console.log('   ✗ NINGUNA obra viva tiene este monto como presupuesto.');
      if (cerca) {
        const dif = cerca.presupuesto - res.total;
        console.log(`     La más cercana es ${cerca.id} «${cerca.nombre}»: ${MXN(cerca.presupuesto)},`);
        console.log(`     que se descuadra ${dif > 0 ? '+' : ''}${MXN(dif)} ` +
          `(${(dif / res.total * 100).toFixed(2)}% del anexo).`);
      }
      console.log('     NO SE PUEDE CARGAR sin explicar la diferencia.');
      malos++; continue;
    }
    if (candidatas.length > 1) {
      console.log(`   ✗ AMBIGUO: ${candidatas.length} obras tienen este mismo monto ` +
        `(${candidatas.map(o => o.id).join(', ')}). El monto no desempata; hace falta otro dato.`);
      malos++; continue;
    }

    const o = candidatas[0];
    const exacto = alCentavo.length === 1;
    const plazoObra = dias(o.inicio, o.fin);
    console.log(`   ✓ OBRA ${o.id} · «${o.nombre}»`);
    console.log(`     monto del anexo ${MXN(res.total)} contra presupuesto ${MXN(o.presupuesto)}:`);
    console.log(`     ${exacto ? 'CUADRAN AL CENTAVO' : `cuadran al peso, difieren ${MXN(o.presupuesto - res.total)}`}`);
    console.log('');
    console.log('     y lo corrobora, sin haberlo usado para emparejar:');
    const ok = (b) => b ? 'sí ' : 'NO ';
    console.log(`       ${ok(res.inicio ? res.inicio === o.inicio : true)}arranque   anexo ${res.inicio || '(no lo trae)'} · obra ${o.inicio || '—'}`);
    console.log(`       ${ok(res.fin ? res.fin === o.fin : true)}término    anexo ${res.fin || '(no lo trae)'} · obra ${o.fin || '—'}`);
    console.log(`       ${ok(plazoArchivo === null || plazoObra === null || Math.abs(plazoArchivo - plazoObra) <= 1)}plazo      anexo ${plazoArchivo === null ? '(no fechado)' : plazoArchivo + ' d'} · obra ${plazoObra === null ? '—' : plazoObra + ' d'}`);
    const cliArchivo = norm(id.cliente), cliObra = norm(o.cliente);
    const clienteCompatible = !!(cliArchivo && cliObra) &&
      (cliArchivo.includes(cliObra) || cliObra.includes(cliArchivo) ||
       cliArchivo.split(/\s+/).filter(w => w.length > 4 && cliObra.includes(w)).length >= 2);
    console.log(`       ${ok(clienteCompatible)}cliente    anexo «${(id.cliente || '—').slice(0, 44)}»`);
    console.log(`                     obra  «${(o.cliente || '—').slice(0, 44)}»`);
    // Palabras del nombre de la obra del sistema que aparecen en el archivo.
    const textoArchivo = norm([id.obra, id.lugar, res.partidas.map(p => p.desc).join(' ')].join(' '));
    const palabras = norm(o.nombre).split(/[^A-Z0-9]+/).filter(w => w.length >= 5);
    const coinciden = palabras.filter(w => textoArchivo.includes(w));
    console.log(`       ${ok(coinciden.length > 0)}nombre     ${coinciden.length} de ${palabras.length} palabras del nombre del sistema salen en el archivo` +
      (coinciden.length ? `: ${coinciden.join(', ')}` : ''));

    // ── EL SEGUNDO CRUCE, INDEPENDIENTE DEL MONTO ──────────────────────────
    //
    // Cuando el campo `contrato` de la obra trae la descripción legal, se
    // compara LETRA POR LETRA contra el renglón «Obra:» del anexo. Esto importa
    // más que los demás corroborantes por un motivo concreto: el emisor, el
    // cliente y el lugar de los dos anexos de PENTÁGONO son IDÉNTICOS, así que
    // no distinguen el emisor del colector. Si los dos archivos estuvieran
    // intercambiados, el monto lo cacharía y esto lo cacharía otra vez. Dos
    // anclas independientes, no una repetida.
    // NO SE MIDE EL PREFIJO, SE MIDE EL INTERCAMBIO. Un umbral de «40
    // caracteres iguales» habría dado por bueno el emparejamiento cruzado: los
    // dos anexos de PENTÁGONO empiezan los dos con «REHABILITACIÓN DE RED DE
    // DRENAJE SANITARIO (», que son 44 caracteres idénticos, y divergen en la
    // palabra 45. Un umbral absoluto no distingue; lo que distingue es que la
    // obra emparejada gane a la SEGUNDA MEJOR por un margen. Así que se compara
    // contra todas y se dice por cuánto gana.
    const descAnexo = norm(id.obra);
    const prefijo = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
    const conDesc = obras.filter(x => vivo(x) && descDe(x.contrato));
    if (descAnexo && conDesc.length) {
      const rank = conDesc
        .map(x => ({ id: x.id, n: prefijo(descAnexo, norm(descDe(x.contrato))) }))
        .sort((a, b) => b.n - a.n);
      const gana = rank[0], segunda = rank[1] || null;
      const esLaMisma = gana.id === o.id;
      const margen = segunda ? gana.n - segunda.n : gana.n;
      const basta = esLaMisma && margen >= 10;
      console.log(`       ${ok(basta)}DESCRIPCIÓN el renglón «Obra:» del anexo (${descAnexo.length} car.) contra el campo`);
      console.log(`                     «contrato» de las ${conDesc.length} obras que lo guardan:`);
      for (const r of rank.slice(0, 3)) {
        console.log(`                       ${r.id}: ${String(r.n).padStart(3)} caracteres iguales` +
          (r.id === o.id ? '   ← la emparejada por monto' : ''));
      }
      console.log(`                     gana ${gana.id} por ${margen} caracteres de margen`);
      if (!esLaMisma) {
        console.log('                     ← CONTRADICE AL MONTO. No se escribe nada hasta resolverlo.');
        malos++;
      } else if (margen < 10) {
        console.log('                     ← MARGEN INSUFICIENTE: la descripción no desempata sola');
        malos++;
      }
    } else if (descAnexo) {
      console.log('       -- DESCRIPCIÓN ninguna obra guarda la descripción legal: no hay segundo cruce');
    }
    if (o.yaTienePrograma) {
      console.log('');
      console.log('     OJO: esta obra YA tiene programa cargado. Escribir lo pisa.');
    }
  }

  console.log('');
  console.log('═'.repeat(78));
  if (malos) {
    console.log(`${malos} de ${archivos.length} anexos NO tienen obra única por monto. No se escribe nada.`);
    process.exit(1);
  }
  console.log(`Los ${archivos.length} anexos tienen UNA obra viva cada uno, por monto.`);
  process.exit(0);
})();
