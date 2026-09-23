#!/usr/bin/env node
// Prueba: la salida de emergencia devuelve la nómina al documento viejo sin
// esconder nada.
//
// El hueco que cubre: la escritura NO es dual. Con la bandera en 2 una nómina
// capturada entra sólo a la subcolección. Bajar la bandera a secas ese día no
// borra nada, pero deja de enseñarlo, y una semana que nadie sabe que existe
// no la reclama nadie. La reversión tiene que negarse en ese caso y decir qué
// escondería.
//
// Dos mitades:
//
//   1. La decisión, extraída del guion y alimentada con pares de historiales,
//      incluidos los que engañarían a un comparador que sólo cuente.
//   2. El guion ENTERO corriendo contra un Firestore de mentiras, para ver
//      qué escribe de verdad: si manda el PATCH, con qué máscara, en qué
//      orden, y si respeta los acentos que cruzan la frontera de un paquete.
//
// Uso:  node scripts/prueba-revertir-bandera.cjs [archivo]

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

const archivo = process.argv[2] ||
  path.join(raiz, 'scripts/revertir-bandera-nomina.cjs');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'script' });

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
});

const NECESARIOS = ['MXN', 'huella', 'nombrar', 'loQueSePerderia'];
const faltan = NECESARIOS.filter(n => !decl[n]);
if (faltan.length) noArranco(faltan, path.basename(archivo));

const { loQueSePerderia } = new Function(`"use strict";
  ${NECESARIOS.map(n => `const ${n} = ${decl[n]};`).join('\n  ')}
  return { loQueSePerderia };`)();

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const texto = (r) => (r ? r.lineas.join('\n') : '');

// Cargas con la forma de las reales de la 0126: su semana 38 rayada en dos
// archivos, el mismo día y la misma semana.
const carga = (archivo, semana, total, nombres) => ({
  archivo, semana, fecha: '22/9/2026', totalNomina: total,
  trabajadores: nombres.map(nombre => ({ nombre })),
});
const peones = (n, i0 = 0) => [...Array(n)].map((_, i) => `PEÓN ${i0 + i}`);
const P1 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 38.xlsx', 'SEM 38', 502603,
  ['JOSÉ MUÑOZ ÁNGELES', ...peones(50)]);
const P2 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 38. P2xlsx.xlsx', 'SEM 38', 152950,
  peones(35, 100));
const S37 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 37.xlsx', 'SEM 37', 647179,
  peones(138, 200));
const S39 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 39.xlsx', 'SEM 39', 700000,
  peones(140, 400));

console.log('1. Cuándo revertir es gratis\n');
check(loQueSePerderia([S37, P1, P2], [S37, P1, P2]) === null,
  'si el documento viejo tiene lo mismo que la subcolección, se revierte sin más');
check(loQueSePerderia([S37, P1, P2], [P2, S37, P1]) === null,
  'y reordenar no cuenta como diferencia — Firestore no promete orden');
check(loQueSePerderia([], []) === null,
  'una obra sin nómina en ninguno de los dos lados no bloquea');
check(loQueSePerderia([S37, P1, P2], []) === null,
  'una subcolección vacía no esconde nada: no hay qué perder');

console.log('\n2. Lo capturado después del despliegue PARA la reversión\n');
const nueva = loQueSePerderia([S37, P1, P2], [S37, P1, P2, S39]);
check(nueva !== null,
  'una semana capturada después de migrar frena la bandera');
check(nueva?.motivo === 'divergen', 'y se clasifica como divergencia', nueva?.motivo);
check(/SEM 39/.test(texto(nueva)),
  'el aviso dice QUÉ archivo se escondería, no sólo que algo difiere',
  texto(nueva).split('\n').find(l => /esconde/.test(l))?.trim());
check(/140 trab/.test(texto(nueva)) && /\$700,000/.test(texto(nueva)),
  'y con cuánta gente y cuánto dinero, que es lo que se reclama');

console.log('\n3. Los cambios que contar no ve\n');
// El residente corrige una carga mal subida: misma cuenta de registros, otro
// dinero. Un comparador que cuente diría que no pasó nada.
const editada = loQueSePerderia([S37, P1, P2], [S37, P1, { ...P2, totalNomina: 160000 }]);
check(editada !== null,
  'una carga corregida después de migrar frena la bandera aunque la cuenta no cambie');
check(/\$160,000/.test(texto(editada)),
  'y se nombra la versión nueva, que es la que se perdería de vista');
check(/reaparece/.test(texto(editada)) && /\$152,950/.test(texto(editada)),
  'diciendo además que reaparecería la vieja, para que nadie crea que quedó igual');

// Las dos partes de la semana 38 son la misma semana y el mismo día: si la
// huella no mirara archivo y dinero se verían iguales.
check(loQueSePerderia([S37, P1, P2], [S37, P1, P1]) !== null,
  'cambiar una parte de la semana rayada por copia de la otra no pasa inadvertido');

console.log('\n4. Lo que sólo está en el documento viejo NO es un bloqueo\n');
// Al revertir, esas cargas vuelven a verse. Se recuperan, no se pierden.
const soloViejo = loQueSePerderia([S37, P1, P2], [S37, P1]);
check(soloViejo === null,
  'una carga que está en el viejo y no en la subcolección deja revertir',
  'reaparece en pantalla en lugar de desaparecer');

console.log('\n5. El documento viejo ya vaciado es un bloqueo aparte\n');
const vacio = loQueSePerderia([], [S37, P1, P2]);
check(vacio?.motivo === 'vacio',
  'con el viejo vacío y la subcolección llena, el motivo es «vacio», no «divergen»',
  vacio?.motivo);
check(/cero semanas/.test(texto(vacio)),
  'y se dice el efecto en pantalla: cero semanas de nómina');
check(/copiar la subcolección de vuelta/.test(texto(vacio)),
  'con la salida real, que no es la bandera');

// ════════════════════════════════════════════════════════════════════════════
// El guion entero contra un Firestore de mentiras
// ════════════════════════════════════════════════════════════════════════════
// Aquí no se mira el código: se corre y se apunta lo que intenta escribir. El
// falso servidor aplica los PATCH con la semántica real de Firestore —sin
// máscara se reemplaza el documento entero— que es lo que hace que la máscara
// anidada se note.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revertir-'));
const espia = path.join(dir, 'firestore-de-mentiras.cjs');
fs.writeFileSync(espia, `'use strict';
const fs = require('fs');
const https = require('https');
const { EventEmitter } = require('events');

const bd = JSON.parse(fs.readFileSync(process.env.FALSA_BD, 'utf8'));
const bitacora = [];

const leerReal = fs.readFileSync;
fs.readFileSync = function (p, ...r) {
  if (p === '/tmp/adc.tok') return 'token-de-mentiras\\n';
  return leerReal.call(fs, p, ...r);
};

const aValor = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  return { mapValue: { fields: aCampos(v) } };
};
const aCampos = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, aValor(v)]));
const deValor = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) return deCampos(v.mapValue);
  return null;
};
const deCampos = (d) => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, deValor(v)]));

const PREFIJO = '/v1/projects/campo-fosmon/databases/(default)/documents';

const destino = (ruta) => {
  let m;
  if ((m = ruta.match(/^\\/obras\\/(\\w+)\\/config\\/info$/)))
    return { obra: m[1], cual: 'info' };
  if ((m = ruta.match(/^\\/obras\\/(\\w+)\\/nomina\\/historial$/)))
    return { obra: m[1], cual: 'viejo' };
  if ((m = ruta.match(/^\\/obras\\/(\\w+)\\/nomina_historial$/)))
    return { obra: m[1], cual: 'sub' };
  return null;
};

// Semántica de Firestore: con updateMask sólo se tocan esos campos (anidados
// incluidos); SIN updateMask el documento se reemplaza por completo.
const aplicar = (doc, cuerpo, mascaras) => {
  const nuevo = deCampos(cuerpo);
  if (!mascaras.length) return nuevo;
  for (const ruta of mascaras) {
    const partes = ruta.split('.');
    let origen = nuevo, meta = doc;
    for (const p of partes.slice(0, -1)) {
      origen = (origen || {})[p];
      if (typeof meta[p] !== 'object' || meta[p] === null || Array.isArray(meta[p])) meta[p] = {};
      meta = meta[p];
    }
    meta[partes[partes.length - 1]] = (origen || {})[partes[partes.length - 1]];
  }
  return doc;
};

https.request = (opc, cb) => {
  const req = new EventEmitter();
  let cuerpo = '';
  req.write = (c) => { cuerpo += c; };
  req.end = () => {
    const completa = opc.path.slice(PREFIJO.length);
    const [ruta, consulta] = completa.split('?');
    const d = destino(ruta);
    const obra = d && (bd.obras[d.obra] || null);
    let estado = 200, datos = {};

    if (opc.method === 'GET') {
      if (!obra) estado = 404;
      else if (d.cual === 'sub')
        datos = { documents: Object.entries(obra.sub || {}).map(([id, doc]) => ({
          name: 'projects/campo-fosmon/databases/(default)/documents/obras/' +
                d.obra + '/nomina_historial/' + id,
          fields: aCampos(doc) })) };
      else if (!obra[d.cual]) estado = 404;
      else datos = { fields: aCampos(obra[d.cual]) };
    } else {
      const mascaras = (consulta || '').split('&')
        .filter(x => x.startsWith('updateMask.fieldPaths='))
        .map(x => decodeURIComponent(x.split('=')[1]));
      bitacora.push({ metodo: opc.method, ruta, mascaras, cuerpo: JSON.parse(cuerpo || '{}') });
      if (!obra || !d) estado = 404;
      else {
        obra[d.cual] = aplicar(obra[d.cual] || {}, JSON.parse(cuerpo || '{}'), mascaras);
        datos = { fields: aCampos(obra[d.cual]) };
      }
    }

    const resp = new EventEmitter();
    resp.statusCode = estado;
    process.nextTick(() => {
      const buf = Buffer.from(JSON.stringify(datos), 'utf8');
      // Se parte el cuerpo DENTRO de un carácter multibyte, como lo parte un
      // paquete de red. Un lector que concatene strings devuelve U+FFFD aquí.
      let corte = buf.length;
      for (let i = 1; i < buf.length - 1; i++)
        if (buf[i] >= 0xC0) { corte = i + 1; break; }
      resp.emit('data', buf.subarray(0, corte));
      resp.emit('data', buf.subarray(corte));
      resp.emit('end');
    });
    cb(resp);
  };
  return req;
};

process.on('exit', () => {
  fs.writeFileSync(process.env.FALSA_BITACORA,
    JSON.stringify({ bitacora, bd }, null, 1));
});
`);

const correr = (bd, args) => {
  const fBd = path.join(dir, 'bd.json');
  const fBit = path.join(dir, 'bitacora.json');
  fs.writeFileSync(fBd, JSON.stringify(bd));
  const r = spawnSync(process.execPath, ['-r', espia, archivo, ...args], {
    cwd: raiz, encoding: 'utf8',
    env: { ...process.env, FALSA_BD: fBd, FALSA_BITACORA: fBit },
  });
  const { bitacora, bd: final } = JSON.parse(fs.readFileSync(fBit, 'utf8'));
  return { salida: (r.stdout || '') + (r.stderr || ''), codigo: r.status, bitacora, final };
};

const obraCon = (viejo, sub, info) => ({
  obras: { '0126': {
    info: { nombre: 'CANGREJERA', cliente: 'PEMEX',
            formatoHistorial: { nomina: 2, avance: 1 }, ...info },
    viejo: { semanas: viejo },
    sub,
  } },
});
const porSemana = (clave, partes) => ({ clave, partes, actualizado: '2026-09-23T00:00:00.000Z' });

console.log('\n6. Reversión inocua: se baja la bandera y nada más\n');
{
  const { salida, codigo, bitacora, final } = correr(
    obraCon([S37, P1, P2], {
      'Y2026-S37': porSemana('Y2026-S37', [S37]),
      'Y2026-S38': porSemana('Y2026-S38', [P1, P2]),
    }),
    ['--escribir', '--obra', '0126']);

  check(/bandera = 1/.test(salida) && codigo === 0,
    'la obra vuelve a leer del documento viejo', `salida ${codigo}`);
  check(final.obras['0126'].info.formatoHistorial.nomina === 1,
    'la bandera quedó en 1 en config/info',
    JSON.stringify(final.obras['0126'].info.formatoHistorial));
  check(final.obras['0126'].info.formatoHistorial.avance === 1 &&
        final.obras['0126'].info.nombre === 'CANGREJERA',
    'sin llevarse por delante `avance` ni el resto de config/info',
    'la máscara anidada · sin ella el mapa entero se reemplaza y `avance` desaparece');
  check(bitacora.length === 1 && bitacora[0].ruta === '/obras/0126/config/info',
    'no se tocó nada más: una sola escritura, la de la bandera',
    bitacora.map(b => `${b.metodo} ${b.ruta}`).join(', ') || 'ninguna');
  check(!bitacora.some(b => b.metodo === 'DELETE') &&
        Object.keys(final.obras['0126'].sub).length === 2,
    'la subcolección sigue entera — revertir no es desmigrar');
  check(final.obras['0126'].viejo.semanas.length === 3,
    'y el documento viejo se quedó como estaba', `${final.obras['0126'].viejo.semanas.length} cargas`);
}

console.log('\n7. Con una captura nueva en la subcolección, NO escribe nada\n');
{
  const { salida, codigo, bitacora, final } = correr(
    obraCon([S37, P1, P2], {
      'Y2026-S37': porSemana('Y2026-S37', [S37]),
      'Y2026-S38': porSemana('Y2026-S38', [P1, P2]),
      'Y2026-S39': porSemana('Y2026-S39', [S39]),
    }),
    ['--escribir', '--obra', '0126']);

  check(bitacora.length === 0,
    'cero escrituras: la bandera no se movió', `${bitacora.length} PATCH`);
  check(final.obras['0126'].info.formatoHistorial.nomina === 2,
    'la obra sigue leyendo de la subcolección, que es donde está la semana 39');
  check(/NO SE REVIERTE/.test(salida) && /SEM 39/.test(salida),
    'y la pantalla dice por qué y cuál es la carga en riesgo',
    salida.split('\n').find(l => /esconde/.test(l))?.trim());
  check(codigo === 1, 'termina en rojo, no en silencio', `salida ${codigo}`);
  check(/--reconciliar/.test(salida),
    'diciendo cómo revertir igual sin perderla');
}

console.log('\n8. Documento viejo vaciado + --reconciliar: copia antes de bajar\n');
{
  const { salida, codigo, bitacora, final } = correr(
    obraCon([], {
      'Y2026-S37': porSemana('Y2026-S37', [S37]),
      'Y2026-S38': porSemana('Y2026-S38', [P1, P2]),
    }),
    ['--escribir', '--reconciliar', '--obra', '0126']);

  const rutas = bitacora.map(b => b.ruta);
  check(codigo === 0 && /bandera = 1/.test(salida), 'la reversión llega hasta el final',
    `salida ${codigo}`);
  check(rutas[0] === '/obras/0126/nomina/historial' &&
        rutas[1] === '/obras/0126/config/info' && rutas.length === 2,
    'primero se copia la subcolección al documento viejo, DESPUÉS baja la bandera',
    rutas.join(' → '));
  const semanas = final.obras['0126'].viejo.semanas;
  check(semanas.length === 3 &&
        Math.round(semanas.reduce((t, r) => t + r.totalNomina, 0)) === 1302732,
    'el documento viejo quedó con las 3 cargas y el dinero cuadrado',
    `${semanas.length} cargas · $${semanas.reduce((t, r) => t + r.totalNomina, 0).toLocaleString('es-MX')}`);
  const nombres = semanas.flatMap(r => r.trabajadores.map(t => t.nombre));
  check(nombres.length === 224 && nombres.includes('JOSÉ MUÑOZ ÁNGELES'),
    'con los 224 nombres enteros, acentos y Ñ incluidos',
    'el cuerpo llegó partido dentro de un carácter, como lo parte la red');
  check(!JSON.stringify(final).includes('\ufffd'),
    'cero caracteres de reemplazo en todo lo escrito');
  check(bitacora[0].mascaras.includes('semanas'),
    'la copia va con máscara, no reemplazando el documento entero',
    bitacora[0].mascaras.join(', ') || 'sin máscara');
  check(final.obras['0126'].info.formatoHistorial.avance === 1,
    'y `avance` sigue en su sitio después de las dos escrituras');
}

console.log('\n9. Sin --escribir no se toca producción\n');
{
  const { salida, bitacora } = correr(
    obraCon([], {
      'Y2026-S37': porSemana('Y2026-S37', [S37]),
    }),
    ['--reconciliar', '--obra', '0126']);
  check(bitacora.length === 0, 'el ensayo no manda un solo PATCH', `${bitacora.length}`);
  check(/ensayo/i.test(salida), 'y lo dice en pantalla');
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(fallas
  ? `\n${fallas} comprobación(es) en rojo.`
  : '\nTodas las comprobaciones en verde.');
process.exit(fallas ? 1 : 0);
