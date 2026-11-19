#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL GUION QUE BORRA EL MAPA DE `avance/subs` NO PUEDE PERDER UNA FOTO
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE PRUEBA, Y POR QUÉ ASÍ. `borrar-el-mapa-de-fotos-de-subs.cjs` es lo
// más destructivo que hay en `scripts/`: quita referencias de producción y
// Firestore no tiene papelera. El 2026-11-18 quitó 668 y se portó bien, pero
// esa corrida no es una prueba: fue una medición de una vez, a mano, sobre los
// datos de ese día. Si mañana alguien toca el guion —y va a tocarse, porque
// 0128 y 0131 siguen sin migrar— nada avisaría.
//
// NO SE EXTRAEN PEDAZOS: SE CORRE EL GUION ENTERO. Comprobar `rutaDeStorage`
// por su cuenta dejaría fuera lo que de verdad asusta, que es el orden —¿el
// respaldo se escribió ANTES del PATCH?— y el enchufe —¿la negativa está
// conectada al borrado, o es una función perfecta que nadie llama?—. Así que
// este banco levanta un **Firestore de mentira** en `127.0.0.1`, le apunta el
// guion con `FIRESTORE_EMULATOR_HOST`, y mira lo que el guion HACE: qué PATCH
// manda, cuáles no manda, en qué momento aparece el respaldo y con qué sale.
//
// EL HOGAR SE MUDA A UN DIRECTORIO DE USAR Y TIRAR. El guion escribe el
// respaldo bajo `os.homedir()`, que en POSIX es `$HOME`. El banco le pasa un
// `HOME` temporal al hijo: así se comprueba el respaldo DE VERDAD —ruta,
// contenido, momento— sin dejar basura en `~/Desarrollo/CAMPO-datos-produccion`,
// que es donde viven los volcados buenos. No se tocó el guion para esto.
//
// LOS DATOS LLEVAN TIPOS A PROPÓSITO. Las partidas traen `integerValue`,
// `doubleValue`, `timestampValue`, mapas y arreglos anidados, porque el defecto
// silencioso de este guion sería convertir el JSON crudo a objetos de
// JavaScript y de vuelta: un entero volvería como `doubleValue` y nadie lo
// vería hasta que algo sumara mal meses después.
//
// CONTRAPRUEBAS — corridas el 2026-11-18, las seis en ROJO (1), ninguna en
// NO ARRANCÓ (2). Entre paréntesis, cuántas aserciones mordieron cada una:
//
//   · el cruce se hace por la URL COMPLETA y no por la ruta de
//     Storage — el `?…&token=` cambió al migrar, así que daría
//     «no está» para fotos que sí están                         → rojo (15)
//   · se quita la negativa por huérfanas y borra igual           → rojo  (7)
//   · se quita la negativa por obra sin migrar                   → rojo  (3)
//   · el respaldo se escribe DESPUÉS del PATCH                   → rojo  (3)
//   · la comprobación final se hace contra lo que se MANDÓ en
//     vez de contra lo que quedó al releer                       → rojo  (2)
//   · el array se reconstruye pasando por valores de JavaScript,
//     que devuelve los enteros como `doubleValue`                → rojo  (6)
//
// La revisión de anclajes sí corre en `npm test`, aunque las seis corridas no:
// un anclaje que se queda viejo dejó de vigilar su defecto, y eso se tiene que
// saber el día que pasa, no dentro de seis meses.
//
// Uso:  node scripts/prueba-el-borrado-del-mapa-no-pierde-fotos.cjs [guion]
//       node scripts/prueba-el-borrado-del-mapa-no-pierde-fotos.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const CP = require('./contraprueba.cjs');

// El guion a ejercitar se puede sustituir por argumento: así la contraprueba le
// apunta un mutante en vez del original. Una bandera no es una ruta.
const RUTA_GUION = path.join(raiz, 'scripts/borrar-el-mapa-de-fotos-de-subs.cjs');
const GUION = process.argv.slice(2).find(a => !a.startsWith('--')) || RUTA_GUION;
if (!fs.existsSync(GUION)) {
  noArranco.sinPrecondicion(`el guion ${GUION}`,
    'Es el archivo que esta prueba ejercita; sin él no hay nada que comprobar.');
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Las mutaciones ──────────────────────────────────────────────────────────
// Cada una es una forma concreta de que este guion pierda una foto o borre
// donde no debe. Si alguna sale verde, la aserción que tenía que atraparla no
// afirma nada. No son defectos imaginarios: son las cinco decisiones que
// costaron pensar al escribirlo, más la sexta que es el error de tipo que
// nadie vería hasta que algo sumara mal meses después.
const MUTANTES = [
  { titulo: 'el cruce se hace por la URL completa y no por la ruta de Storage',
    cambios: [['      const r = rutaDeStorage(u);\n      return !r || !conDoc.has(r);',
               '      return !conDoc.has(u);']] },
  { titulo: 'se quita la negativa por huérfanas y borra igual',
    cambios: [['    if (huerfanas.length) {', '    if (false) {']] },
  { titulo: 'se quita la negativa por obra sin migrar',
    cambios: [['    if (!migrada) {', '    if (false) {']] },
  { titulo: 'el respaldo se escribe DESPUÉS del PATCH',
    cambios: [
      ['    const f = respaldar(o.id, doc);\n    console.log(`      respaldo  ${f}`);\n\n', ''],
      ['      { fields: { data: { arrayValue: { values: nuevas } } } });',
       '      { fields: { data: { arrayValue: { values: nuevas } } } });\n\n' +
       '    const f = respaldar(o.id, doc);\n    console.log(`      respaldo  ${f}`);'],
    ] },
  { titulo: 'la comprobación final se hace contra lo que se MANDÓ, no contra lo que quedó',
    cambios: [['    const vuelta = await fs_(\'GET\', `/${o.prefijo}obras/${o.id}/avance/subs`);',
               '    const vuelta = { fields: { data: { arrayValue: { values: nuevas } } } };']] },
  { titulo: 'el array se reconstruye pasando por valores de JavaScript',
    cambios: [[
      '    const nuevas = partidas.map(p => {\n' +
      '      if (!p?.mapValue?.fields?.fotos) return p;\n' +
      '      const campos2 = { ...p.mapValue.fields };\n' +
      '      delete campos2.fotos;\n' +
      '      return { mapValue: { fields: campos2 } };\n' +
      '    });',
      [
        '    const aValor = (x) => {',
        "      if (typeof x === 'string') return { stringValue: x };",
        "      if (typeof x === 'number') return { doubleValue: x };",
        "      if (typeof x === 'boolean') return { booleanValue: x };",
        '      if (Array.isArray(x)) return { arrayValue: { values: x.map(aValor) } };',
        "      if (x && typeof x === 'object') return { mapValue: { fields:",
        '        Object.fromEntries(Object.entries(x).map(([k, v]) => [k, aValor(v)])) } };',
        '      return { nullValue: null };',
        '    };',
        '    const nuevas = partidas.map(p => {',
        '      const c = campos(p.mapValue); delete c.fotos; return aValor(c);',
        '    });',
      ].join('\n')]] },
];

// EL MUTANTE TIENE QUE VIVIR EN `scripts/`. El guion hace
// `require('./destino.cjs')`, que se resuelve contra SU propio directorio: un
// mutante en `/tmp` revienta al arrancar y eso sería NO ARRANCÓ (2), que no
// demuestra que ninguna aserción muerda. Así que se copia al lado del original
// y se borra al salir.
const copiados = [];
process.on('exit', () => {
  for (const f of copiados) { try { fs.unlinkSync(f); } catch { /* ya no está */ } }
});
const comoCorrer = (ruta) => {
  const destino = path.join(raiz, 'scripts',
    `mutante-borrado-${process.pid}-${copiados.length}.cjs`);
  fs.copyFileSync(ruta, destino);
  copiados.push(destino);
  return { args: [destino], env: { SIN_CONTRAPRUEBA: '1' } };
};

// La revisión de anclajes es estática y gratis, y corre SIEMPRE —también en
// `npm test`—: un anclaje rancio es una mutación que dejó de vigilar algo, y
// ninguna contraprueba se vuelve a correr sola. Menos cuando este proceso
// examina un mutante, donde los anclajes faltan a propósito.
const SRC_GUION = fs.readFileSync(RUTA_GUION, 'utf8');
if (!process.env.SIN_CONTRAPRUEBA && GUION === RUTA_GUION) {
  CP.exigirAnclajes(MUTANTES, SRC_GUION, { archivo: RUTA_GUION });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  console.log('\n── contraprueba · borrar-el-mapa-de-fotos-de-subs.cjs ──────\n');
  const s = CP.correr({
    mutaciones: MUTANTES, src: SRC_GUION, archivo: RUTA_GUION,
    prefijo: 'borrado-mapa-', comoCorrer,
  });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── Un Firestore de mentira ─────────────────────────────────────────────────
// Habla el dialecto REST que usa el guion y nada más. Guarda los documentos
// como JSON crudo —igual que Firestore— para que un cambio de tipo se vea.
const BASE = '/v1/projects/campo-fosmon/databases/(default)/documents';

const levantar = (documentos, { alRecibirPatch = null, patchGuarda = null } = {}) => {
  const docs = JSON.parse(JSON.stringify(documentos));
  const patches = [];

  const servidor = http.createServer((req, res) => {
    const [ruta] = req.url.split('?');
    const rel = ruta.startsWith(BASE) ? ruta.slice(BASE.length) : ruta;
    const responder = (code, cuerpo) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cuerpo || {}));
    };

    if (req.method === 'GET') {
      // Una colección: se devuelven los documentos que cuelgan de ella.
      const hijos = Object.keys(docs).filter(k =>
        k.startsWith(rel + '/') && !k.slice(rel.length + 1).includes('/'));
      if (hijos.length)
        return responder(200, { documents: hijos.map(k => ({ ...docs[k], name: k })) });
      if (docs[rel]) return responder(200, { ...docs[rel], name: rel });
      // Colección vacía: Firestore contesta 200 sin `documents`, no 404.
      if (/^\/(obras|orgs)$|obras$|evidencia$/.test(rel)) return responder(200, {});
      return responder(404, { error: { message: 'no está' } });
    }

    if (req.method === 'PATCH') {
      let cuerpo = '';
      req.on('data', d => cuerpo += d);
      return req.on('end', () => {
        const enviado = JSON.parse(cuerpo || '{}');
        // El gancho se dispara ANTES de guardar: así el banco puede mirar el
        // mundo —por ejemplo, si el respaldo ya existe— en el instante exacto
        // en que la escritura llega, que es la única forma de afirmar un orden.
        patches.push({ ruta: rel, enviado, mirado: alRecibirPatch ? alRecibirPatch() : null });
        // `patchGuarda` permite que el servidor guarde algo DISTINTO de lo que
        // se mandó. Sirve para comprobar que la verificación final del guion
        // relee de verdad en vez de creerle a lo que acaba de enviar.
        docs[rel] = patchGuarda ? patchGuarda(docs[rel], enviado) : { ...docs[rel], ...enviado };
        responder(200, docs[rel]);
      });
    }
    responder(405, {});
  });

  // El servidor vive en ESTE proceso y el guion corre en otro. Por eso el
  // banco entero es asíncrono: con `spawnSync` el bucle de eventos del padre
  // se queda bloqueado esperando al hijo, nadie contesta las peticiones y las
  // dos partes se esperan para siempre. No es un detalle de estilo.
  return new Promise(res => {
    servidor.listen(0, '127.0.0.1', () =>
      res({ servidor, docs, patches, puerto: servidor.address().port }));
  });
};

// ── Correr el guion contra ese Firestore ────────────────────────────────────
// Con plazo, y el plazo vencido es NO ARRANCÓ (2), nunca rojo: un hijo que no
// contesta no es una conducta medida, es una conducta sin medir.
const PLAZO = 60_000;

// AQUÍ NO HAY UN CAMINO A PRODUCCIÓN, Y ES A PROPÓSITO. Este banco corre el
// guion más destructivo del repositorio; dejar un `destino: 'prod'` que nadie
// usa sería dejar cargado el gatillo que el 2026-10-09 escribió 270 documentos
// en producción por un `EMU_HOST` olvidado. `--prod` no se puede pedir desde
// aquí: los dos destinos son el Firestore de mentira y ninguno.
const DESTINOS = ['emulador', 'ninguno'];

const correr = (montaje, { escribir = true, destino = 'emulador', hogar = null } = {}) => {
  if (!DESTINOS.includes(destino))
    noArranco.sinPrecondicion(`el destino «${destino}»`,
      `Este banco sólo corre contra ${DESTINOS.join(' o ')}; nunca contra producción.`);
  const HOME = hogar || fs.mkdtempSync(path.join(os.tmpdir(), 'hogar-borrado-'));
  const args = [GUION];
  const env = { ...process.env, HOME };
  if (destino === 'emulador') env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${montaje.puerto}`;
  else delete env.FIRESTORE_EMULATOR_HOST;
  if (escribir) args.push('--escribir');

  return new Promise((res) => {
    const hijo = require('child_process').spawn(process.execPath, args, { env });
    let texto = '';
    hijo.stdout.on('data', d => texto += d);
    hijo.stderr.on('data', d => texto += d);
    const reloj = setTimeout(() => {
      hijo.kill('SIGKILL');
      console.log('\nNO ARRANCÓ — el guion no contestó en ' + (PLAZO / 1000) + ' s.');
      console.log('Lo que lleva impreso:\n' + texto.slice(-600));
      process.exit(noArranco.NO_ARRANCO);
    }, PLAZO);
    hijo.on('close', (salida) => { clearTimeout(reloj); res({ salida, texto, HOME }); });
  });
};

const carpetaRespaldo = (HOME) => {
  const base = path.join(HOME, 'Desarrollo', 'CAMPO-datos-produccion');
  if (!fs.existsSync(base)) return null;
  const d = fs.readdirSync(base).find(x => x.startsWith('subs-antes-de-borrar-el-mapa'));
  return d ? path.join(base, d) : null;
};

// ── Datos ───────────────────────────────────────────────────────────────────
// Una foto en el mapa: cadena suelta, que es como está en producción.
const fotoURL = (ruta, token) =>
  `https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/` +
  `${encodeURIComponent(ruta)}?alt=media&token=${token}`;

// Una partida con tipos variados a propósito: lo que no se quita tiene que
// volver EXACTAMENTE igual, tipo incluido.
const partida = (id, fotos) => ({
  mapValue: { fields: {
    id: { stringValue: id },
    sec: { stringValue: `${id} · TERRACERÍAS` },
    cant: { integerValue: '720' },            // entero: no puede volver double
    pu: { doubleValue: 4271.5 },
    cerradaEn: { timestampValue: '2026-10-09T01:43:24.145Z' },
    a: { mapValue: { fields: { '38': { integerValue: '12' } } } },
    tags: { arrayValue: { values: [{ stringValue: 'norte' }] } },
    ...(fotos ? { fotos: { arrayValue: { values: fotos.map(u => ({ stringValue: u })) } } } : {}),
  } },
});

const docEvidencia = (rutaStorage) => ({ fields: { rutaStorage: { stringValue: rutaStorage } } });

// El mundo base: una obra migrada, con dos partidas con fotos y una sin.
const mundo = ({ migrada = true, conDocumento = ['a.jpg', 'b.jpg', 'c.jpg'] } = {}) => {
  const d = {
    '/obras/0114': { fields: { nombre: { stringValue: 'OAXACA PARQUE LINEAL' } } },
    '/obras/0114/config/evidencia': { fields: { migrada: { booleanValue: migrada } } },
    '/obras/0114/avance/subs': { fields: { data: { arrayValue: { values: [
      partida('1', [fotoURL('obras/0114/a.jpg', 'TOK-NUEVO-1'),
                    fotoURL('obras/0114/b.jpg', 'TOK-NUEVO-2')]),
      partida('2', null),
      partida('3', [fotoURL('obras/0114/c.jpg', 'TOK-NUEVO-3')]),
    ] } } } },
  };
  // Los documentos de la subcolección guardan la RUTA, y las URLs del mapa
  // traen OTRO token: así el cruce por URL entera no puede colar.
  conDocumento.forEach((f, i) => {
    d[`/obras/0114/evidencia/doc${i}`] = docEvidencia(`obras/0114/${f}`);
  });
  return d;
};

const partidasDe = (doc) => (doc?.fields?.data?.arrayValue?.values) || [];
const conMapa = (doc) => partidasDe(doc).filter(p => p.mapValue?.fields?.fotos).length;
const sinFotos = (p) => {
  if (!p.mapValue?.fields?.fotos) return JSON.stringify(p);
  const c = { ...p.mapValue.fields };
  delete c.fotos;
  return JSON.stringify({ mapValue: { fields: c } });
};

// Levanta el Firestore de mentira, corre lo que se le pida contra él y lo
// apaga pase lo que pase: un servidor que queda escuchando deja el banco
// colgado al final, que es un NO ARRANCÓ disfrazado de prueba lenta.
const conServidor = async (documentos, opciones, fn) => {
  const m = await levantar(documentos, opciones);
  try { return await fn(m); } finally { m.servidor.close(); }
};

// ════════════════════════════════════════════════════════════════════════════

(async () => {

console.log(`\nSe ejercita: ${path.relative(raiz, GUION)}`);

console.log('\n1. La obra migrada y limpia pierde el mapa, y NADA más\n');
{
  await conServidor(mundo(), {}, async (m) => {
    const antes = JSON.parse(JSON.stringify(m.docs['/obras/0114/avance/subs']));
    const { salida } = await correr(m);
    const despues = m.docs['/obras/0114/avance/subs'];

    check(salida === 0, 'el guion sale en verde', `salida ${salida}`);
    check(m.patches.length === 1, 'manda exactamente un PATCH',
      `${m.patches.length} PATCH(es)`);
    check(conMapa(despues) === 0, 'no queda ni una partida con mapa',
      `${conMapa(despues)} con mapa`);
    check(partidasDe(despues).length === 3, 'las tres partidas siguen ahí',
      `${partidasDe(despues).length} partida(s)`);

    const iguales = partidasDe(antes).every((p, i) =>
      sinFotos(p) === sinFotos(partidasDe(despues)[i]));
    check(iguales, 'cada partida vuelve idéntica, menos la llave `fotos`');

    // El tipo, que es donde se esconde el defecto silencioso.
    const cant = partidasDe(despues)[0]?.mapValue?.fields?.cant;
    check(cant && 'integerValue' in cant,
      'un entero sigue siendo entero y no se volvió `doubleValue`',
      cant ? Object.keys(cant)[0] : '(no está)');
    const ts = partidasDe(despues)[0]?.mapValue?.fields?.cerradaEn;
    check(ts && 'timestampValue' in ts, 'un timestamp sigue siendo timestamp',
      ts ? Object.keys(ts)[0] : '(no está)');

    // La partida que nunca tuvo fotos no se tocó.
    check(sinFotos(partidasDe(antes)[1]) === JSON.stringify(partidasDe(despues)[1]),
      'la partida que no tenía fotos vuelve tal cual');
  });
}

console.log('\n2. El cruce es por ruta de Storage, no por la URL entera\n');
{
  // Las URLs del mapa traen `TOK-NUEVO-*` y los documentos sólo guardan la
  // ruta. Si se comparara la URL completa, las tres saldrían «huérfanas» y el
  // guion se negaría — que es el rojo de la contraprueba.
  await conServidor(mundo(), {}, async (m) => {
    const { salida, texto } = await correr(m);
    check(salida === 0 && m.patches.length === 1,
      'reconoce como propias fotos cuyo token cambió al migrar',
      `salida ${salida}, ${m.patches.length} PATCH(es)`);
    check(!/NO SE TOCA/.test(texto), 'y no acusa huérfanas que no lo son');
  });
}

console.log('\n3. UNA sola foto sin documento deja la obra ENTERA sin tocar\n');
{
  // `c.jpg` se queda sin documento: dos de tres están a salvo, pero borrar
  // perdería la tercera. Lo correcto es no borrar ninguna.
  await conServidor(mundo({ conDocumento: ['a.jpg', 'b.jpg'] }), {}, async (m) => {
    const { salida, texto } = await correr(m);
    check(m.patches.length === 0, 'no manda ningún PATCH',
      `${m.patches.length} PATCH(es)`);
    check(conMapa(m.docs['/obras/0114/avance/subs']) === 2,
      'las dos partidas con mapa siguen enteras, también las que sí tenían documento');
    check(salida === 1, 'y sale en ROJO, no en verde', `salida ${salida}`);
    check(/1 de 3 URL\(s\)/.test(texto), 'y dice cuántas eran de cuántas',
      (texto.match(/.*de 3 URL\(s\).*/) || [''])[0].trim());
  });
}

console.log('\n4. Una obra SIN migrar no se toca, aunque todo tenga documento\n');
{
  // Aquí el mapa es lo que alimenta la galería: quitárselo sería borrarla.
  await conServidor(mundo({ migrada: false }), {}, async (m) => {
    const { texto } = await correr(m);
    check(m.patches.length === 0, 'no manda ningún PATCH',
      `${m.patches.length} PATCH(es)`);
    check(conMapa(m.docs['/obras/0114/avance/subs']) === 2,
      'el mapa se queda donde está');
    check(/no está migrada/.test(texto), 'y dice por qué no la tocó');
  });
}

console.log('\n5. El respaldo existe ANTES de que llegue la escritura\n');
{
  let HOME = null;
  await conServidor(mundo(), {
    alRecibirPatch: () => {
      const c = HOME && carpetaRespaldo(HOME);
      return c ? fs.readdirSync(c) : [];
    },
  }, async (m) => {
    HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hogar-borrado-'));
    await correr(m, { hogar: HOME });

    const vistoAlEscribir = m.patches[0]?.mirado || [];
    check(vistoAlEscribir.includes('0114-avance-subs.json'),
      'cuando el PATCH llega, el respaldo ya está en disco',
      vistoAlEscribir.length ? vistoAlEscribir.join(', ') : '(carpeta vacía)');

    const c = carpetaRespaldo(HOME);
    const guardado = c && fs.readFileSync(path.join(c, '0114-avance-subs.json'), 'utf8');
    check(!!guardado && /TOK-NUEVO-1/.test(guardado) && /TOK-NUEVO-3/.test(guardado),
      'y trae dentro las URLs que se van a quitar');
    check(!!c && /-emulador-/.test(path.basename(c)),
      'la carpeta dice a qué destino era la corrida',
      c ? path.basename(c) : '(no hay carpeta)');
    check(!!c && !/PRODUCCION/.test(path.basename(c)),
      'y una corrida de emulador no se puede confundir con una de producción');
  });
}

console.log('\n6. Si el respaldo no se puede escribir, no se borra nada\n');
{
  await conServidor(mundo(), {}, async (m) => {
    // Un ARCHIVO donde tiene que ir la carpeta: `mkdirSync` revienta.
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hogar-borrado-'));
    fs.mkdirSync(path.join(HOME, 'Desarrollo'), { recursive: true });
    fs.writeFileSync(path.join(HOME, 'Desarrollo', 'CAMPO-datos-produccion'), 'estorbo');

    const { salida } = await correr(m, { hogar: HOME });
    check(m.patches.length === 0, 'no escribe sin red',
      `${m.patches.length} PATCH(es)`);
    check(conMapa(m.docs['/obras/0114/avance/subs']) === 2, 'el mapa sigue entero');
    check(salida !== 0, 'y no se declara en verde', `salida ${salida}`);
  });
}

console.log('\n7. El ensayo no escribe, y lo dice\n');
{
  await conServidor(mundo(), {}, async (m) => {
    const { salida, texto, HOME } = await correr(m, { escribir: false });
    check(m.patches.length === 0, 'sin `--escribir` no manda ningún PATCH',
      `${m.patches.length} PATCH(es)`);
    check(carpetaRespaldo(HOME) === null, 'ni escribe respaldo de un ensayo');
    check(/ENSAYO: se quitarían 3 URL\(s\) de 1 obra/.test(texto),
      'y dice cuántas quitaría, que es para lo que sirve un ensayo',
      (texto.match(/ENSAYO.*/) || [''])[0].trim());
    check(salida === 0, 'el ensayo sale en verde', `salida ${salida}`);
  });
}

console.log('\n8. Sin destino no corre, y no toca la red\n');
{
  await conServidor(mundo(), {}, async (m) => {
    const { salida, texto } = await correr(m, { destino: 'ninguno' });
    check(salida === 2, 'sale NO ARRANCÓ (2), que no es rojo ni verde',
      `salida ${salida}`);
    check(m.patches.length === 0, 'y no mandó nada');
    check(/No hay destino/.test(texto), 'y explica que el destino se escribe');
  });
}

console.log('\n9. La comprobación final relee: no le cree a lo que mandó\n');
{
  // El servidor acepta el PATCH y guarda OTRA cosa —una partida que conserva
  // su mapa—. Un guion que verifique contra lo que envió cantaría victoria.
  await conServidor(mundo(), {
    patchGuarda: (viejo) => viejo,   // se queda como estaba: el borrado no prendió
  }, async (m) => {
    const { salida, texto } = await correr(m);
    check(salida === 1, 'lo nota y sale en ROJO', `salida ${salida}`);
    check(/ROJO/.test(texto), 'y lo dice con todas sus letras',
      (texto.match(/.*ROJO.*/) || [''])[0].trim().slice(0, 70));
    check(/respaldo/.test(texto), 'y recuerda dónde quedó el respaldo');
  });
}

console.log('\n10. No se le cree a una corrida anterior: el cruce se rehace\n');
{
  // Dos obras en el mismo mundo: la primera limpia, la segunda con una
  // huérfana. Si el guion decidiera una vez y aplicara a todas, borraría la
  // segunda; tiene que medir obra por obra.
  const d = mundo();
  d['/obras/0126'] = { fields: { nombre: { stringValue: 'PEMEX CANGREJERA' } } };
  d['/obras/0126/config/evidencia'] = { fields: { migrada: { booleanValue: true } } };
  d['/obras/0126/avance/subs'] = { fields: { data: { arrayValue: { values: [
    partida('9', [fotoURL('obras/0126/z.jpg', 'TOK-Z')]),
  ] } } } };
  // …y ni un documento para `z.jpg`.

  await conServidor(d, {}, async (m) => {
    const { salida } = await correr(m);
    const patch0114 = m.patches.filter(p => /0114/.test(p.ruta)).length;
    const patch0126 = m.patches.filter(p => /0126/.test(p.ruta)).length;
    check(patch0114 === 1, 'la obra limpia sí se limpia', `${patch0114} PATCH(es)`);
    check(patch0126 === 0, 'la obra con una huérfana no se toca',
      `${patch0126} PATCH(es)`);
    check(conMapa(m.docs['/obras/0126/avance/subs']) === 1,
      'y su foto sigue en el mapa');
    check(salida === 1, 'y la corrida entera sale en ROJO por la que no pudo',
      `salida ${salida}`);
  });
}

console.log(fallas
  ? `\n${fallas} comprobación(es) en rojo.\n`
  : '\nEl borrado del mapa no pierde una foto, y se niega donde debe.\n');
process.exit(fallas ? 1 : 0);

})();
