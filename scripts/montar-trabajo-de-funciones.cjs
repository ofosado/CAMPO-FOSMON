// MONTAR UN TRABAJO DE CLOUD FUNCTIONS Y MIRAR QUÉ HIZO
//
// Tres andamios que hacen falta para probar CONDUCTA de un trabajo del
// servidor en vez de la existencia de sus símbolos:
//
//   · `piezasDelExport` — saca del archivo real, por AST, el manejador de un
//     `exports.X = onSchedule(config, handler)` y TAMBIÉN su configuración.
//     La configuración es conducta: `schedule` es la hora a la que Cloud
//     Scheduler dispara, o sea el plazo con el que el aviso cumple o no.
//   · `baseFalsa` — un Firestore de mentira, lo mínimo para que el código real
//     corra y se pueda mirar qué escribió. No simula reglas: lo que se mide es
//     la lógica del trabajo, que corre como administrador.
//   · `montar` — mete el manejador y su cierre transitivo en un `new Function`
//     con `require`, `FieldValue`, `fetch` y `defineSecret` inyectados.
//
// ── POR QUÉ ESTÁ AQUÍ Y NO COPIADO ─────────────────────────────────────────
// `baseFalsa` llegó a tener cuatro copias (`prueba-aislamiento-de-usuarios`,
// `prueba-correo-no-cruza-organizaciones`, `prueba-correos-de-alta` y el banco
// del recordatorio del viernes). La quinta copia no se escribió: en cuanto
// hubo DOS consumidores reales de los tres andamios juntos —el banco del
// recordatorio y el de la salud— se sacaron aquí. Los otros tres bancos
// siguen con su copia a propósito: ésos necesitan Auth y claims, que aquí no
// están, y moverlos es un cambio con su propia medición.
//
// ── LO QUE ESTE MÓDULO NO HACE ─────────────────────────────────────────────
// No afirma nada. Un andamio que comprueba se convierte en el sitio donde
// viven las aserciones, y entonces los bancos que lo usan heredan
// comprobaciones que no escribieron y no saben que tienen.

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { FieldValue } = require(path.join(raiz, 'functions/node_modules/firebase-admin/lib/firestore'));
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

// ── El manejador y su configuración, por AST ────────────────────────────────
function piezasDelExport(archivo, nombre) {
  const codigo = fs.readFileSync(archivo, 'utf8');
  const ast = parse(codigo, { sourceType: 'module' });
  let src = null, config = null;
  traverse(ast, {
    AssignmentExpression(p) {
      const iz = p.node.left;
      if (!(iz.type === 'MemberExpression' && iz.object.name === 'exports'
            && iz.property.name === nombre)) return;
      const de = p.node.right;
      if (de.type !== 'CallExpression' || !de.arguments.length) return;
      src = codigo.slice(de.arguments[de.arguments.length - 1].start,
        de.arguments[de.arguments.length - 1].end);
      if (de.arguments.length > 1) {
        config = codigo.slice(de.arguments[0].start, de.arguments[0].end);
      }
    },
  });
  if (!src) noArranco([`exports.${nombre} = onSchedule(…)`], path.relative(raiz, archivo));
  const sub = parse(`(${src})`, { sourceType: 'module' });
  const libres = new Set();
  traverse(sub, {
    ReferencedIdentifier(p) {
      if (p.scope.hasBinding(p.node.name, true)) return;
      libres.add(p.node.name);
    },
  });
  return { src, config, libres: [...libres] };
}

// ── El Firestore de mentira ────────────────────────────────────────────────
//
// `fallaLectura` y `fallaEscritura` reciben la ruta y devuelven el motivo del
// fallo —una cadena— o nada. Hacen falta porque el modo de falla que más
// importa en un trabajo del servidor no es que reviente: es que una lectura
// suelta se caiga, el `catch` de arriba la absorba, y el trabajo siga y se
// anote como bueno. Sin poder tirar UNA ruta, esa conducta no se puede medir.
function baseFalsa(docsIniciales, { fallaLectura = null, fallaEscritura = null } = {}) {
  const docs = new Map(Object.entries(docsIniciales));
  const escrituras = [];
  let seq = 0;

  const tropieza = (quien, ruta) => {
    const motivo = quien && quien(ruta);
    if (motivo) throw new Error(String(motivo));
  };

  const refDoc = (ruta) => ({
    id: ruta.split('/').pop(),
    get: async () => {
      tropieza(fallaLectura, ruta);
      return {
        exists: docs.has(ruta), id: ruta.split('/').pop(),
        data: () => docs.get(ruta), updateTime: null,
      };
    },
    set: async (d, opt) => {
      tropieza(fallaEscritura, ruta);
      escrituras.push({ ruta, d });
      docs.set(ruta, opt && opt.merge ? { ...(docs.get(ruta) || {}), ...d } : d);
    },
    update: async (d) => {
      tropieza(fallaEscritura, ruta);
      escrituras.push({ ruta, d });
      docs.set(ruta, { ...(docs.get(ruta) || {}), ...d });
    },
    collection: (sub) => coleccion(`${ruta}/${sub}`),
  });

  const hijos = (col) => [...docs.entries()]
    .filter(([r]) => r.startsWith(`${col}/`) && !r.slice(col.length + 1).includes('/'))
    .map(([r, d]) => ({ id: r.slice(col.length + 1), data: () => d, updateTime: null, ref: refDoc(r) }));

  const coleccion = (col, filtros = []) => ({
    where: (campo, op, val) => {
      if (!['==', '!=', 'in'].includes(op)) {
        noArranco([`la base de mentira no sabe del operador '${op}'`], 'baseFalsa');
      }
      return coleccion(col, [...filtros, { campo, op, val }]);
    },
    get: async () => {
      tropieza(fallaLectura, col);
      let filas = hijos(col);
      for (const f of filtros) {
        filas = filas.filter(x => {
          const v = x.data()[f.campo];
          // Firestore DESCARTA los documentos sin el campo en una desigualdad.
          if (f.op === '!=') return v !== undefined && v !== f.val;
          if (f.op === 'in') return f.val.includes(v);
          return v === f.val;
        });
      }
      return { docs: filas, size: filas.length, empty: filas.length === 0, forEach: cb => filas.forEach(cb) };
    },
    // `listDocuments` devuelve referencias, no datos, y en Firestore de verdad
    // trae también los documentos «fantasma» que sólo existen porque tienen
    // subcolecciones. Aquí sólo hacen falta los que se sembraron.
    listDocuments: async () => hijos(col).map(h => refDoc(`${col}/${h.id}`)),
    doc: (id) => refDoc(`${col}/${id}`),
    add: async (d) => {
      const ruta = `${col}/auto-${++seq}`;
      tropieza(fallaEscritura, ruta);
      escrituras.push({ ruta, d });
      docs.set(ruta, d);
      return refDoc(ruta);
    },
  });

  return {
    docs, escrituras,
    admin: { firestore: () => ({ doc: refDoc, collection: coleccion }), initializeApp: () => {} },
  };
}

// Monta la pieza real sobre la base de mentira.
//
// `rebota` es el buzón al que el servidor de correo le dice no: hace falta
// para medir qué hace el trabajo cuando un correo no sale. Acepta una cadena
// o una lista.
function montar(archivo, nombreExport, base, { correos = [], rebota = null, inyecciones = {} } = {}) {
  const { src, libres } = piezasDelExport(archivo, nombreExport);
  let cuerpo;
  try {
    ({ cuerpo } = fuenteDe(archivo, libres, { tolerante: true }));
  } catch (e) {
    if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
    throw e;
  }
  const rebotan = rebota === null ? [] : (Array.isArray(rebota) ? rebota : [rebota]);
  const fetchFalso = async (url, opciones) => {
    const sobre = { url, ...JSON.parse(opciones.body || '{}') };
    if (rebotan.some(r => (sobre.to || []).includes(r))) {
      return { ok: false, status: 422, json: async () => ({ message: 'buzón inexistente' }) };
    }
    correos.push(sobre);
    return { ok: true, status: 200, json: async () => ({ id: `re_${correos.length}` }) };
  };
  const inyectar = {
    require: (modulo) => {
      if (modulo === 'firebase-admin') return base.admin;
      if (modulo === 'firebase-admin/firestore') return { FieldValue };
      return require(modulo);
    },
    FieldValue,
    fetch: fetchFalso,
    defineSecret: () => ({ value: () => 'clave-de-mentira' }),
    ...inyecciones,
  };
  const nombres = Object.keys(inyectar);
  try {
    return new Function(...nombres,
      `"use strict";\n${cuerpo}\nreturn (${src});`)(...nombres.map(n => inyectar[n]));
  } catch (e) {
    noArranco([`no se pudo montar \`${nombreExport}\`: ${e.message}`], path.relative(raiz, archivo));
  }
}

module.exports = { piezasDelExport, baseFalsa, montar };
