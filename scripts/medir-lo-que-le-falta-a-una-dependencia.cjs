#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ LE FALTA A UNA DEPENDENCIA PARA VER UNA OBRA? (PENDIENTES #69)
// ════════════════════════════════════════════════════════════════════════════
//
// Solo LEE. Son peticiones GET al API de Firestore y una al de Identity
// Toolkit; no hay un solo POST, PATCH ni DELETE en este archivo.
//
// POR QUÉ EXISTE. La fila del #69 dice que para recorrer la vista de
// dependencia «hace falta dar de alta la cuenta». Eso es necesario y no es
// suficiente, y la diferencia no es un detalle: `obras` es una colección
// PREFIJADA por organización (`src/rutas-org.js:129`), así que una
// constructora las tiene en la raíz —`obras/0112`— y una dependencia en
// `orgs/{oid}/obras`. Un directivo de dependencia con `todas_obras: true` ve
// todas las de SU ruta, que en una organización recién creada son cero.
//
// O sea que el recorrido «entrar, ver sus obras, subir una foto, verla en la
// galería» no se puede hacer con sólo una cuenta nueva: hace falta que exista
// una obra bajo esa ruta. Eso es una escritura a producción mucho mayor que un
// alta, y nadie la ha autorizado — por eso esto MIDE y no toca nada.
//
// Lo que contesta, con los datos de producción y no con los que yo suponga:
//
//   1. ¿Qué organizaciones existen, de qué tipo, y cuántas son dependencia?
//   2. ¿Cuántos usuarios hay, de qué tipo y de qué organización?
//   3. ¿Cuántas obras hay en la raíz —las de la constructora—?
//   4. ¿Cuántas hay bajo `orgs/{oid}/obras` para cada organización?
//   5. Para cada dependencia: ¿tiene usuario? ¿tiene obra? ¿podría recorrerse
//      hoy el camino completo?
//
// La pregunta 4 es la que importa y es la que nadie había hecho.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-lo-que-le-falta-a-una-dependencia.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const PROYECTO = process.env.PROYECTO_PROD || 'campo-fosmon';
const BASE = `/v1/projects/${PROYECTO}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch {
  noArranco.sinPrecondicion('no hay token de lectura en /tmp/adc.tok',
    ['Este medidor lee producción con credenciales de aplicación.',
     'Conseguirlas primero:',
     '',
     '  gcloud auth application-default print-access-token > /tmp/adc.tok']);
}
if (!TOKEN) {
  noArranco.sinPrecondicion('el token de /tmp/adc.tok está vacío',
    ['Un token vacío contesta 401 a todo, y entonces este medidor diría',
     '«cero organizaciones» sobre un proyecto que las tiene. Eso es peor',
     'que no medir.']);
}

// Una lectura que falla PARA el guion. Devolver `null` y seguir es cómo un
// token vencido se publica como «la dependencia no tiene obras»: la respuesta
// correcta y la avería se ven igual, y la avería sale en verde.
function get(host, ruta) {
  return new Promise((resolve, reject) => {
    https.get({ host, path: ruta, headers: { Authorization: `Bearer ${TOKEN}` } },
      res => {
        let cuerpo = '';
        res.on('data', d => { cuerpo += d; });
        res.on('end', () => {
          if (res.statusCode === 200) return resolve(JSON.parse(cuerpo));
          // 404 en una subcolección vacía es la respuesta, no una avería.
          if (res.statusCode === 404) return resolve({ documents: [] });
          reject(new Error(`${res.statusCode} en ${ruta}: ${cuerpo.slice(0, 300)}`));
        });
      }).on('error', reject);
  });
}

const str = (d, campo) => d.fields && d.fields[campo] && d.fields[campo].stringValue;
const bool = (d, campo) => d.fields && d.fields[campo] && d.fields[campo].booleanValue;
const idDe = (d) => d.name.split('/').pop();

// Trae una colección entera, siguiendo las páginas. Sin esto, una colección de
// más de 300 documentos se mide a medias y la cifra publicada es falsa.
async function coleccion(ruta) {
  const todos = [];
  let token = '';
  do {
    const r = await get('firestore.googleapis.com',
      `${BASE}/${ruta}?pageSize=300${token ? `&pageToken=${token}` : ''}`);
    if (r.documents) todos.push(...r.documents);
    token = r.nextPageToken || '';
  } while (token);
  return todos;
}

(async () => {
  console.log(`\nLo que le falta a una dependencia para ver una obra — ${PROYECTO}`);
  console.log('Solo lectura. Este guion no escribe nada.\n');

  // ── 1. Las organizaciones ────────────────────────────────────────────────
  const orgs = await coleccion('orgs');
  const dependencias = orgs.filter(o => str(o, 'tipo') === 'dependencia');
  const constructoras = orgs.filter(o => str(o, 'tipo') === 'constructora');

  console.log(`1. ORGANIZACIONES: ${orgs.length}`);
  if (orgs.length === 0) console.log('   (ninguna)');
  for (const o of orgs) {
    const activa = bool(o, 'activa');
    console.log(`   ${idDe(o).padEnd(22)} ${(str(o, 'tipo') || '(sin tipo)').padEnd(14)}` +
      `${activa === false ? 'INACTIVA  ' : ''}${str(o, 'nombre') || ''}`);
  }
  console.log(`   → ${constructoras.length} constructora(s) · ${dependencias.length} dependencia(s)`);

  // ── 2. Los usuarios ──────────────────────────────────────────────────────
  const usuarios = await coleccion('usuarios');
  const porOrg = new Map();
  for (const u of usuarios) {
    const clave = `${str(u, 'orgId') || '(sin orgId)'}`;
    if (!porOrg.has(clave)) porOrg.set(clave, []);
    porOrg.get(clave).push(u);
  }
  console.log(`\n2. USUARIOS: ${usuarios.length}`);
  for (const [org, lista] of [...porOrg].sort()) {
    const roles = lista.map(u => str(u, 'rol') || '(sin rol)');
    const cuenta = roles.reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {});
    console.log(`   ${org.padEnd(22)} ${String(lista.length).padStart(3)}  ` +
      Object.entries(cuenta).map(([r, n]) => `${r}×${n}`).join(' · '));
  }

  // ── 3. Las obras de la raíz: las de la constructora ──────────────────────
  const obrasRaiz = await coleccion('obras');
  console.log(`\n3. OBRAS EN LA RAÍZ (de la constructora): ${obrasRaiz.length}`);
  console.log(`   ${obrasRaiz.map(idDe).sort().join(' ') || '(ninguna)'}`);

  // ── 4. La pregunta que nadie había hecho ─────────────────────────────────
  console.log(`\n4. OBRAS BAJO orgs/{oid}/obras — la ruta que lee una dependencia`);
  const obrasPorOrg = new Map();
  for (const o of orgs) {
    const oid = idDe(o);
    const suyas = await coleccion(`orgs/${oid}/obras`);
    obrasPorOrg.set(oid, suyas);
    console.log(`   ${oid.padEnd(22)} ${String(suyas.length).padStart(3)} obra(s)` +
      `${suyas.length ? `  ${suyas.map(idDe).sort().join(' ')}` : ''}`);
  }
  if (orgs.length === 0) console.log('   (no hay organizaciones que mirar)');

  // ── 5. ¿Se puede recorrer el camino hoy? ─────────────────────────────────
  console.log(`\n5. ¿SE PUEDE RECORRER LA VISTA DE DEPENDENCIA HOY?`);
  if (dependencias.length === 0) {
    console.log('   NO: no existe ninguna organización de tipo dependencia.');
    console.log('   Hacen falta TRES cosas, no una:');
    console.log('     a) la organización  orgs/{oid}  con tipo: "dependencia"');
    console.log('     b) un usuario de esa org (Auth + usuarios/{id} + claims)');
    console.log('     c) al menos una obra en  orgs/{oid}/obras  — sin esto la');
    console.log('        pantalla entra y enseña un portafolio VACÍO, que no es');
    console.log('        el recorrido que el #69 pide ni lo que se le enseña a');
    console.log('        un director de Obras Públicas.');
  }
  for (const d of dependencias) {
    const oid = idDe(d);
    const u = porOrg.get(oid) || [];
    const ob = obrasPorOrg.get(oid) || [];
    const falta = [];
    if (u.length === 0) falta.push('un usuario');
    if (ob.length === 0) falta.push('al menos una obra en su ruta');
    console.log(`   ${oid.padEnd(22)} ${falta.length
      ? `NO — le falta ${falta.join(' y ')}`
      : `SÍ — ${u.length} usuario(s) y ${ob.length} obra(s)`}`);
  }

  console.log('');
  console.log('─'.repeat(74));
  console.log('Lo medido, no lo supuesto: `obras` va prefijada por organización');
  console.log('(src/rutas-org.js:129), así que «ve todas las obras» significa');
  console.log('todas las de SU ruta. Una dependencia sin obras propias entra a');
  console.log('un portafolio vacío.');
  console.log('');
  process.exit(0);
})().catch(e => {
  // Por `vigilarExcepciones`: una lectura que revienta sale 2, no 1. No se
  // midió nada, y eso no es un rojo.
  throw e;
});
