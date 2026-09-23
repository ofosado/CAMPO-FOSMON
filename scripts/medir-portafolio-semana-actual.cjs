#!/usr/bin/env node
// SOLO LECTURA. Qué enseña HOY el Panel Ejecutivo en los cinco sitios que leen
// la nómina por POSICIÓN (`nominaSemanas[length-1]`), y qué enseñaría si
// leyeran la última semana del CALENDARIO con sus partes sumadas.
//
// No es una prueba: es un contraste, para poder decir con cifras qué números
// del consolidado se mueven antes de tocar una línea.
//
// Los cinco sitios (líneas de `src/App.jsx` en main, acb3b17):
//   6005  MANO DE OBRA CONSOLIDADA · SEMANA ACTUAL  (los seis kpiBox)
//   6473  personalAgg          — Personal consolidado del bloque 1
//   6509  personalPrev         — delta de personal del bloque 1
//   6595  aviso `he_alta`      — HE > 25% de la nómina de la semana
//   6628  fila de la tabla     — Personal y su delta, por obra
//
// El cálculo de "hoy" y el de "bien" son EL MISMO código: cambia sólo de qué
// arreglo sale `ult`. Así la diferencia no puede venir de haber reescrito la
// fórmula.
//
// Uso:
//   export PATH="/opt/homebrew/bin:$PATH"
//   TOKEN=$(gcloud auth application-default print-access-token) \
//     node scripts/medir-portafolio-semana-actual.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const PROYECTO = 'campo-fosmon';
const BASE = `/v1/projects/${PROYECTO}/databases/(default)/documents`;
const TOKEN = process.env.TOKEN || (() => {
  try { return fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); } catch { return null; }
})();
if (!TOKEN) { console.error('Falta TOKEN.'); process.exit(1); }

const pedir = (ruta) => new Promise((res, rej) => {
  https.request({
    host: 'firestore.googleapis.com', path: BASE + ruta, method: 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO },
  }, r => {
    // Ver PENDIENTES, «El transporte que decodificaba a medias»: sin
    // `setEncoding`, un carácter UTF-8 partido entre dos trozos TCP se
    // decodifica a la mitad por cada lado.
    r.setEncoding('utf8');
    let b = ''; r.on('data', c => b += c);
    r.on('end', () => {
      if (r.statusCode === 404) return res(null);
      if (r.statusCode >= 300) return rej(new Error(`${r.statusCode} ${ruta}: ${b.slice(0,200)}`));
      res(JSON.parse(b));
    });
  }).on('error', rej).end();
});

// Firestore REST → JS plano.
const val = (v) => {
  if ('nullValue'    in v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue'     in v) return campos(v.mapValue.fields || {});
  return null;
};
const campos = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));

// ── Los helpers, extraídos del archivo de verdad ────────────────────────────
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
});
const NECESARIOS = ['semanaISO', 'heImporte', 'numSemanaNomina', 'fechaCargaNomina',
  'añoSemanaNomina', 'claveSemanaNomina', 'semanasDeNomina'];
const faltan = NECESARIOS.filter(n => !decl[n]);
if (faltan.length) { console.error('No se pudo montar: falta ' + faltan.join(', ')); process.exit(2); }
const api = new Function(`"use strict";
  ${NECESARIOS.map(n => `const ${n} = ${decl[n]};`).join('\n  ')}
  return { ${NECESARIOS.join(', ')} };`)();
const { heImporte, semanasDeNomina } = api;

// ── Los cinco sitios, con la fórmula tal como está en main ──────────────────
// `porObra` es { obraId: nominaSemanas }. Es lo único que cambia entre los dos
// escenarios.
const panelEjecutivo = (porObra) => {
  const ids = Object.keys(porObra);

  // 6005 · MANO DE OBRA CONSOLIDADA · SEMANA ACTUAL
  let totalEmp = 0, dir = 0, ind = 0, nomTotal = 0, heHrs = 0, heImp = 0;
  let obrasConDato = 0, tendencia = null;
  for (const id of ids) {
    const semanas = porObra[id] || [];
    if (semanas.length === 0) continue;
    const ult = semanas[semanas.length - 1];
    totalEmp += (ult.totalDir || 0) + (ult.totalInd || 0);
    dir      += (ult.totalDir || 0);
    ind      += (ult.totalInd || 0);
    nomTotal += (ult.totalNomina || 0);
    if (typeof ult.totalHEHrs === 'number') heHrs += ult.totalHEHrs;
    else if (Array.isArray(ult.trabajadores)) heHrs += ult.trabajadores.reduce((t,p)=>t+(p.horasExtra||0),0);
    heImp += heImporte(ult);
    obrasConDato++;
    if (semanas.length >= 2) {
      const prev = semanas[semanas.length - 2];
      tendencia = (tendencia||0) + ((ult.totalNomina || 0) - (prev.totalNomina || 0));
    }
  }
  const pctInd = totalEmp > 0 ? (ind / totalEmp) * 100 : 0;
  const costoProm = totalEmp > 0 ? nomTotal / totalEmp : 0;

  // 6473 · personalAgg
  const personalAgg = ids.reduce((t, id) => {
    const ult = (porObra[id] || []).slice(-1)[0];
    if (!ult) return t;
    return {
      total: t.total + (ult.totalDir || 0) + (ult.totalInd || 0),
      dir:   t.dir   + (ult.totalDir || 0),
      ind:   t.ind   + (ult.totalInd || 0),
      obrasConNom: t.obrasConNom + 1,
    };
  }, { total: 0, dir: 0, ind: 0, obrasConNom: 0 });

  // 6509 · personalPrev y el delta del bloque 1
  let personalPrev = 0, obrasSinPrevNom = 0;
  for (const id of ids) {
    const nom = porObra[id] || [];
    if (nom.length === 0) continue;
    if (nom.length >= 2) {
      const pre = nom[nom.length - 2];
      personalPrev += (pre.totalDir || 0) + (pre.totalInd || 0);
    } else obrasSinPrevNom++;
  }
  const deltaPersonal = (personalAgg.obrasConNom > 0 && obrasSinPrevNom === 0)
    ? personalAgg.total - personalPrev : null;

  // 6595 · aviso `he_alta`
  const avisosHE = [];
  for (const id of ids) {
    const nomSemanas = porObra[id] || [];
    const ultNom = nomSemanas[nomSemanas.length - 1];
    if (!ultNom) continue;
    const totalNom = ultNom.totalNomina || (ultNom.trabajadores || []).reduce((t,p)=>t+(p.total||0), 0);
    const totalHE  = heImporte(ultNom);
    if (totalNom > 0) {
      const pct = totalHE / totalNom * 100;
      if (pct > 25) avisosHE.push(`${id} — HE al ${pct.toFixed(0)}% (${$(totalHE)} de ${$(totalNom)})`);
    }
  }

  // 6628 · fila de la tabla: Personal y su delta, por obra
  const filas = ids.map(id => {
    const nomSemanas = porObra[id] || [];
    const ultNom = nomSemanas[nomSemanas.length - 1];
    const preNom = nomSemanas.length >= 2 ? nomSemanas[nomSemanas.length - 2] : null;
    const personal = ultNom ? ((ultNom.totalDir || 0) + (ultNom.totalInd || 0)) : null;
    const prev     = preNom ? ((preNom.totalDir || 0) + (preNom.totalInd || 0)) : null;
    return { id, semana: ultNom ? ultNom.semana : null,
      personal, delta: (personal !== null && prev !== null) ? personal - prev : null };
  });

  return { totalEmp, dir, ind, nomTotal, heHrs, heImp, obrasConDato, tendencia,
    pctInd, costoProm, personalAgg, personalPrev, deltaPersonal, obrasSinPrevNom,
    avisosHE, filas };
};

const $ = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const N = n => (n === null ? '—' : String(n));
const pmb = (h, b) => (h === b ? '  =' : ' ≠ ');

// ── Correr ─────────────────────────────────────────────────────────────────
(async () => {
  const lista = await pedir('/obras?pageSize=100');
  const obras = (lista.documents || []).map(d => ({
    id: d.name.split('/').pop(),
    ...campos(d.fields || {}),
  })).filter(o => o.estado !== 'archivada');

  const crudo = {}, calendario = {}, nombre = {};
  for (const o of obras) {
    const d = await pedir(`/obras/${o.id}/nomina/historial`);
    const semanas = d ? (campos(d.fields || {}).semanas || []) : [];
    if (semanas.length === 0) continue;
    crudo[o.id] = semanas;
    calendario[o.id] = semanasDeNomina(semanas);
    nombre[o.id] = o.contrato || o.nombre || o.id;
  }

  const HOY  = panelEjecutivo(crudo);
  const BIEN = panelEjecutivo(calendario);

  console.log('\nObras activas con nómina cargada: ' + Object.keys(crudo).length);
  for (const id of Object.keys(crudo))
    console.log(`  ${id}  ${nombre[id]} — ${crudo[id].length} cargas, ${calendario[id].length} semanas de calendario`);

  console.log('\n══ LA SEMANA QUE CADA OBRA APORTA AL CONSOLIDADO ══\n');
  console.log('   obra    hoy (última carga)              bien (última del calendario)');
  for (const id of Object.keys(crudo)) {
    const h = crudo[id][crudo[id].length - 1];
    const b = calendario[id][calendario[id].length - 1];
    const et = s => `${s.semana} · ${((s.totalDir||0)+(s.totalInd||0))} pers · ${$(s.totalNomina)}`;
    const partes = b.partes.length > 1 ? `  (${b.partes.length} partes sumadas)` : '';
    console.log(`   ${id}    ${et(h).padEnd(32)}${et(b)}${partes}`);
  }

  console.log('\n══ 6005 · MANO DE OBRA CONSOLIDADA · SEMANA ACTUAL ══\n');
  const kpi = (etq, h, b) => console.log(`   ${etq.padEnd(26)} ${String(h).padStart(14)}${pmb(String(h),String(b))}${String(b).padStart(14)}`);
  console.log(`   ${''.padEnd(26)} ${'HOY'.padStart(14)}   ${'BIEN'.padStart(14)}`);
  kpi('Total trabajadores', HOY.totalEmp, BIEN.totalEmp);
  kpi('Directos', HOY.dir, BIEN.dir);
  kpi('Indirectos', HOY.ind, BIEN.ind);
  kpi('  % indirectos', HOY.pctInd.toFixed(1)+'%', BIEN.pctInd.toFixed(1)+'%');
  kpi('Nómina semanal total', $(HOY.nomTotal), $(BIEN.nomTotal));
  kpi('  vs sem. anterior', (HOY.tendencia===null?'—':(HOY.tendencia>=0?'▲ ':'▼ ')+$(Math.abs(HOY.tendencia))),
                            (BIEN.tendencia===null?'—':(BIEN.tendencia>=0?'▲ ':'▼ ')+$(Math.abs(BIEN.tendencia))));
  kpi('Horas extra totales', HOY.heHrs.toFixed(0)+' h', BIEN.heHrs.toFixed(0)+' h');
  kpi('  pagado en HE', $(HOY.heImp), $(BIEN.heImp));
  kpi('Costo prom. semanal', $(HOY.costoProm), $(BIEN.costoProm));
  kpi('(suma de N obras)', HOY.obrasConDato, BIEN.obrasConDato);

  console.log('\n══ 6473 / 6509 · PERSONAL CONSOLIDADO Y SU DELTA (bloque 1) ══\n');
  kpi('Personal total', HOY.personalAgg.total, BIEN.personalAgg.total);
  kpi('  directos', HOY.personalAgg.dir, BIEN.personalAgg.dir);
  kpi('  indirectos', HOY.personalAgg.ind, BIEN.personalAgg.ind);
  kpi('Personal semana previa', HOY.personalPrev, BIEN.personalPrev);
  kpi('Delta de personal', N(HOY.deltaPersonal), N(BIEN.deltaPersonal));

  console.log('\n══ 6595 · AVISO «horas extra al N% de la nómina» ══\n');
  console.log('   hoy   ' + (HOY.avisosHE.join('\n         ') || '(ninguno)'));
  console.log('   bien  ' + (BIEN.avisosHE.join('\n         ') || '(ninguno)'));

  console.log('\n══ 6628 · COLUMNA «Personal» DE LA TABLA, POR OBRA ══\n');
  console.log('   obra    hoy                          bien');
  for (let i = 0; i < HOY.filas.length; i++) {
    const h = HOY.filas[i], b = BIEN.filas[i];
    const et = f => `${f.personal === null ? '—' : f.personal} pers, delta ${N(f.delta)}  (${f.semana||'—'})`;
    const marca = (h.personal === b.personal && h.delta === b.delta) ? ' ' : '≠';
    console.log(`  ${marca} ${h.id}    ${et(h).padEnd(29)}${et(b)}`);
  }
  console.log('');
})().catch(e => { console.error(e.message); process.exit(1); });
