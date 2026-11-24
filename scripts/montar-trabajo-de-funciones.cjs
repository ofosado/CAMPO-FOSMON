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
function baseFalsa(docsIniciales, { fallaLectura = null, fallaEscritura = null,
                                    cuentasIniciales = {} } = {}) {
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
    // `mergeFields` NO estaba, y este doble perdonaba lo que Firestore no
    // perdona: un `set(d, {mergeFields:[...]})` caía en la rama de reemplazo y
    // MACHACABA el documento entero. Encontrado el 2026-11-23 al montar el
    // vigilante de la entrega del correo: el cron escribía `entrega_correo` y
    // el siguiente `registrarSalud` —el de las denegaciones, con sus propios
    // `mergeFields`— se lo llevaba. El renglón «no se escribió» que salía era
    // del doble, no del código.
    //
    // Y es justo lo que `registrarSalud` usa `mergeFields` para evitar desde
    // el 2026-10-23: que reescribir el documento entero machaque lo que otro
    // cron anotó entre la lectura y la escritura. O sea que el doble borraba
    // la conducta que el arreglo introdujo, y cualquier banco que la midiera
    // habría salido verde con el defecto puesto.
    //
    // Semántica de verdad, las dos mitades: de los campos listados se escribe
    // el que viene en los datos, y el que NO viene se BORRA del documento.
    // Lo que no está en la lista no se toca.
    set: async (d, opt) => {
      tropieza(fallaEscritura, ruta);
      escrituras.push({ ruta, d });
      const previo = docs.get(ruta) || {};
      if (opt && Array.isArray(opt.mergeFields)) {
        const nuevo = { ...previo };
        for (const campo of opt.mergeFields) {
          if (Object.prototype.hasOwnProperty.call(d, campo)) nuevo[campo] = d[campo];
          else delete nuevo[campo];
        }
        docs.set(ruta, nuevo);
      } else {
        docs.set(ruta, opt && opt.merge ? { ...previo, ...d } : d);
      }
    },
    update: async (d) => {
      tropieza(fallaEscritura, ruta);
      escrituras.push({ ruta, d });
      docs.set(ruta, { ...(docs.get(ruta) || {}), ...d });
    },
    collection: (sub) => coleccion(`${ruta}/${sub}`),
    // BORRAR TAMBIÉN SE REGISTRA. La base no sabía borrar, así que un trabajo
    // que borra un documento reventaba con `delete is not a function` y ningún
    // banco podía afirmar nada sobre un borrado. Se anota en `escrituras` como
    // cualquier otra, con `borrado: true`, para que el orden de los actos se
    // pueda leer: en más de un trabajo lo que importa no es qué quedó, es QUÉ
    // PASÓ ANTES DE QUÉ.
    delete: async () => {
      tropieza(fallaEscritura, ruta);
      escrituras.push({ ruta, borrado: true });
      docs.delete(ruta);
    },
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

  // ── AUTH DE MENTIRA ───────────────────────────────────────────────────────
  // Lo mínimo para los trabajos que mueven cuentas: buscar por correo, mover
  // el correo y desactivar. Se lleva su propio registro de actos, por lo mismo
  // que las escrituras: hay trabajos donde el orden entre Firestore y Auth es
  // la conducta, no un detalle.
  //
  // `getUserByEmail` LANZA cuando no encuentra, como el de verdad: devolver
  // null haría pasar un `catch(() => null)` que en producción sí se ejecuta, y
  // el banco mediría un camino que nadie recorre.
  const cuentas = new Map(Object.entries(cuentasIniciales));
  const actosAuth = [];
  const auth = () => ({
    getUserByEmail: async (correo) => {
      const uid = cuentas.get(correo);
      if (!uid) { const e = new Error('user-not-found'); e.code = 'auth/user-not-found'; throw e; }
      return { uid, email: correo };
    },
    updateUser: async (uid, cambios) => {
      actosAuth.push({ uid, ...cambios });
      if (cambios.email) {
        for (const [c, u] of [...cuentas.entries()]) if (u === uid) cuentas.delete(c);
        cuentas.set(cambios.email, uid);
      }
    },
    setCustomUserClaims: async (uid, claims) => { actosAuth.push({ uid, claims }); },
    deleteUser: async (uid) => {
      actosAuth.push({ uid, borrado: true });
      for (const [c, u] of [...cuentas.entries()]) if (u === uid) cuentas.delete(c);
    },
  });

  return {
    docs, escrituras, cuentas, actosAuth,
    admin: { firestore: () => ({ doc: refDoc, collection: coleccion }),
             auth, initializeApp: () => {} },
  };
}

// Monta la pieza real sobre la base de mentira.
//
// `rebota` es el buzón al que el servidor de correo le dice no: hace falta
// para medir qué hace el trabajo cuando un correo no sale. Acepta una cadena
// o una lista.
// `modulos` sustituye un módulo de Node por un doble —`{ dns: {...} }`— y es la
// única forma de hacerlo cuando la pieza real lo guarda en una constante de
// módulo: inyectar un nombre que el cierre extraído ya DECLARA revienta con
// `Identifier has already been declared`, porque la inyección es un parámetro
// de la función y la declaración es léxica. Sustituir el módulo deja que la
// constante de verdad se evalúe, con el doble dentro.
function montar(archivo, nombreExport, base,
  { correos = [], rebota = null, inyecciones = {}, modulos = {} } = {}) {
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
  // `HttpsError` SE INYECTA AQUÍ, no en cada banco. Toda callable lo usa para
  // negarse, así que sin él montada la pieza corre el camino bueno y revienta
  // con `HttpsError is not defined` en cuanto toca una negativa: el banco mide
  // sólo la mitad que pasa y las negativas salen como fallas que no lo son.
  // Lleva `code` y `message` como el de verdad, porque los bancos afirman
  // sobre el código —`already-exists`, `failed-precondition`— y no sobre el
  // texto, que cambia.
  class HttpsErrorFalso extends Error {
    constructor(code, message, details) {
      super(message); this.code = code; this.details = details;
      this.name = 'HttpsError';
    }
  }
  // El DNS se sustituye POR OMISIÓN, igual que `fetch`. Un banco que monta
  // `vigilarDenegaciones` sin pasar doble consultaría el DNS DE VERDAD —la
  // medición de la entrega del correo lo consulta—, y entonces el veredicto
  // de la suite dependería de que GoDaddy conteste y de lo que conteste hoy.
  // Así que la omisión no es la red: es un doble que se niega, en voz alta y
  // siempre igual. Quien necesite medir el DNS pasa su zona en `modulos`.
  const dnsQueSeNiega = () => {
    throw new Error('un banco no habla con el DNS de verdad: pásale una zona ' +
      'armada con `modulos: { dns: { promises: … } }`');
  };
  const modulosConDns = {
    dns: { promises: { resolveTxt: dnsQueSeNiega, resolveMx: dnsQueSeNiega,
      resolve: dnsQueSeNiega, resolveCname: dnsQueSeNiega } },
    ...modulos,
  };
  const inyectar = {
    HttpsError: HttpsErrorFalso,
    require: (modulo) => {
      if (Object.prototype.hasOwnProperty.call(modulosConDns, modulo)) return modulosConDns[modulo];
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
