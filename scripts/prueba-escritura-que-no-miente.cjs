#!/usr/bin/env node
// Prueba: UNA ESCRITURA QUE NO QUEDÓ NO PUEDE PASAR INADVERTIDA.
//
// ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
// PENDIENTES #22. `fsSet`, `fsDel` y `fsSetA` devuelven `false` cuando la
// escritura se rechaza, y devolverlo no bastaba: medido por AST sobre
// `src/App.jsx`, 21 de sus llamadas TIRAN el resultado. En esos sitios una
// escritura denegada por reglas se veía exactamente igual que una exitosa.
//
// Ya costó. La obra 0114 perdió SIETE cierres semanales —semanas 32 a 38 de
// 2026— porque el documento rozaba el límite de 1 MiB de Firestore: el
// residente cerraba, la bitácora anotaba «captura oficial», la pantalla decía
// «Guardado», y el historial llevaba parado desde el 2026-07-21. El arreglo
// de aquel caso fue local (`crearSnapshotAvance` escribe directo para que el
// error llegue vivo). Éste es el general: toda escritura rechazada pasa por
// `avisarEscrituraPerdida`, y de ahí a una franja que el usuario ve.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
// Nada de que un símbolo exista (P3). Los cuatro helpers y el canal se
// EXTRAEN POR AST de `src/App.jsx` y se EJECUTAN contra un Firestore de
// mentira que rechaza como rechazan las reglas de verdad. Lo que se mide:
//
//   §1 una escritura rechazada devuelve `false` y NO lanza — porque volverlos
//      estrictos le tumbaría la captura al usuario por un guardado de fondo;
//   §2 …y deja constancia en el canal, con la ruta YA PREFIJADA y el código.
//      La ruta prefijada importa: en una dependencia `obras/0114` y
//      `orgs/x/obras/0114` no son la misma, y la que sirve para diagnosticar
//      una denegación es la que de verdad se intentó;
//   §3 una escritura que SÍ queda no ensucia el canal — un aviso que sale
//      cuando todo fue bien se aprende a ignorar, y entonces no avisa;
//   §4 el canal entrega a quien escucha, y se puede vaciar;
//   §5 ninguna pantalla afirma «Guardado» sin haber consultado el resultado.
//
// La §5 es la que cierra el círculo: §1–§4 garantizan que la pérdida se
// pueda ver, y la §5 que no se diga lo contrario encima.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta `src/App.jsx` por `ARCH_APP` para correrse contra copias mutiladas.
// Cada mutación tiene que salir ROJO (1), nunca NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-escritura-que-no-miente.cjs
//       node scripts/prueba-escritura-que-no-miente.cjs --contraprueba

require('./reloj.cjs');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const ARCH_APP = process.env.ARCH_APP || path.join(raiz, 'src/App.jsx');

// ── La contraprueba ────────────────────────────────────────────────────────
// Corre primero, antes de abrir nada, porque relanza este mismo archivo.
//
// Las anclas son el CUERPO de cada helper, no líneas sueltas: lo que se
// quiere romper es la semántica —«avisa», «no miente»—, no el andamiaje.
if (process.argv[2] === '--contraprueba') {
  const MUTACIONES = [
    { nombre: 'fsSet se traga el rechazo otra vez (vuelve al `console.error`)',
      de: "catch(e) { avisarEscrituraPerdida(r, e); return false; } };\nconst fsDel",
      a:  "catch(e) { console.error('fsSet',e); return false; } };\nconst fsDel" },
    { nombre: 'fsDel se traga el rechazo',
      de: "catch(e) { avisarEscrituraPerdida(r, e); return false; } };\nconst fsColl",
      a:  "catch(e) { return false; } };\nconst fsColl" },
    { nombre: 'fsSetA se traga el rechazo',
      de: '    avisarEscrituraPerdida(r, e);\n    return false;',
      a:  "    console.error('fsSetA', path, e);\n    return false;" },
    { nombre: 'fsSetA avisa con la ruta cruda aunque el prefijo sí resolviera',
      de: '    try { r = conOrg(path); } catch { r = `${path} (sin organización resuelta)`; }',
      a:  '    r = path;' },
    { nombre: 'el canal guarda la ruta SIN prefijo de organización',
      de: '  const fila = {\n    ruta,',
      a:  '  const fila = {\n    ruta: String(ruta).replace(/^orgs\\/[^/]+\\//, ""),' },
    { nombre: 'el canal avisa también cuando la escritura sí quedó',
      de: '  _escriturasPerdidas.push(fila);',
      a:  '  _escriturasPerdidas.push(fila);\n  _escriturasPerdidas.push({ ...fila, ruta: "fantasma" });' },
    { nombre: 'el canal no entrega a quien escucha',
      de: '    try { oyente(copia); } catch (e)',
      a:  '    try { if (false) oyente(copia); } catch (e)' },
    { nombre: 'el canal no se puede vaciar',
      de: 'const olvidarEscriturasPerdidas = () => { _escriturasPerdidas.length = 0; _avisarOyentes(); };',
      a:  'const olvidarEscriturasPerdidas = () => { _avisarOyentes(); };' },
    { nombre: 'la pantalla del contrato vuelve a decir «Guardado» sin mirar',
      de: '    if (okInfo && okRaiz) { setSaved(true); setTimeout(()=>setSaved(false), 2500); }',
      a:  '    setSaved(true); setTimeout(()=>setSaved(false), 2500);' },
    { nombre: 'la pantalla de estimaciones vuelve a decir «Guardado» sin mirar',
      de: '            if (ok1 && ok2) {\n              dispararNotifsCambios(estimaciones);\n' +
          '              setSaved(true); setTimeout(()=>setSaved(false),2500);\n            }',
      a:  '            dispararNotifsCambios(estimaciones);\n' +
          '            setSaved(true); setTimeout(()=>setSaved(false),2500);' },
  ];

  const base = fs.readFileSync(ARCH_APP, 'utf8');
  let malas = 0;
  for (const m of MUTACIONES) {
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log('             el ancla ya no está en src/App.jsx. Una mutación que no');
      console.log('             se aplica no mide nada: reapuntarla o borrarla con su aserción.');
      malas++; continue;
    }
    const arch = path.join(os.tmpdir(),
      `escritura-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.jsx`);
    fs.writeFileSync(arch, base.replace(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_APP: arch } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      console.log((r.stdout + r.stderr).split('\n').slice(-14).map((l) => '             ' + l).join('\n'));
    }
    try { fs.unlinkSync(arch); } catch {}
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven.`
    : `\n${malas} de ${MUTACIONES.length} NO se ven.`);
  process.exit(malas === 0 ? 0 : 1);
}

// ── El banco ───────────────────────────────────────────────────────────────
noArranco.vigilarExcepciones(path.relative(raiz, ARCH_APP));

const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const OPCIONES_PARSE = { sourceType: 'module', plugins: ['jsx'] };
const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPCIONES_PARSE);

// ── Extracción ─────────────────────────────────────────────────────────────
// Declaraciones por nombre: el nombre es la DIRECCIÓN para llegar al código,
// no lo que se afirma (P3). Si alguna cambia de nombre, NO ARRANCÓ (2).
const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init) {
      decl[p.node.id.name] = src.slice(p.node.init.start, p.node.init.end);
    }
  },
  FunctionDeclaration(p) {
    if (p.node.id) decl[p.node.id.name] = src.slice(p.node.start, p.node.end);
  },
});

const NECESARIOS = [
  '_escriturasPerdidas', '_oyentesDeEscritura', '_avisarOyentes',
  'avisarEscrituraPerdida', 'escriturasPerdidas', 'olvidarEscriturasPerdidas',
  'alPerderseUnaEscritura', 'fsSet', 'fsDel', 'fsSetA', 'fsSetAEstricto',
];
const faltan = NECESARIOS.filter((n) => !decl[n]);
if (faltan.length) noArranco(faltan, path.relative(raiz, ARCH_APP));

// ── El mundo de mentira ────────────────────────────────────────────────────
// Un Firestore que rechaza como rechazan las reglas: con un error que trae
// `code`. `doc`, `setDoc` y `deleteDoc` se sustituyen enteros; `conOrg` se
// deja hacer lo que hace de verdad —anteponer el prefijo de organización—
// porque la §2 mide justamente que la ruta prefijada sea la que viaja.
const DENEGADO = Object.assign(new Error('Missing or insufficient permissions.'),
  { code: 'permission-denied' });

function mundo({ falla }) {
  const escritos = [];
  const borrados = [];
  return {
    fbDb: { __db: true },
    doc: (_db, ...segs) => ({ __ruta: segs.join('/') }),
    collection: (_db, ...segs) => ({ __ruta: segs.join('/') }),
    getDoc: async () => ({ exists: () => false, data: () => null }),
    getDocs: async () => ({ docs: [] }),
    setDoc: async (ref, data) => {
      if (falla) throw DENEGADO;
      escritos.push({ ruta: ref.__ruta, data });
    },
    deleteDoc: async (ref) => {
      if (falla) throw DENEGADO;
      borrados.push(ref.__ruta);
    },
    escritos, borrados,
  };
}

// Arma el canal y los helpers con ese mundo. Todo en UN solo `new Function`
// para que compartan el estado del canal, que es justo lo que se mide: un
// canal por copia significaría medir cuatro canales que no se hablan.
function montar({ falla, prefijo }) {
  const m = mundo({ falla });
  const conOrg = (ruta) => (prefijo ? `${prefijo}/${ruta}` : ruta);
  const fsAudit = async () => true;

  const fuente = `
    ${['_escriturasPerdidas', '_oyentesDeEscritura', '_avisarOyentes',
       'avisarEscrituraPerdida', 'escriturasPerdidas',
       'olvidarEscriturasPerdidas', 'alPerderseUnaEscritura',
       'fsGet', 'fsSet', 'fsDel', 'fsSetAEstricto', 'fsSetA']
      .map((n) => `const ${n} = ${decl[n]};`).join('\n')}
    return { avisarEscrituraPerdida, escriturasPerdidas,
             olvidarEscriturasPerdidas, alPerderseUnaEscritura,
             fsSet, fsDel, fsSetA };
  `;

  const libres = ['fbDb', 'doc', 'collection', 'getDoc', 'getDocs', 'setDoc',
                  'deleteDoc', 'conOrg', 'fsAudit'];
  const api = new Function(...libres, fuente)(
    m.fbDb, m.doc, m.collection, m.getDoc, m.getDocs, m.setDoc, m.deleteDoc,
    conOrg, fsAudit);
  return { ...api, mundo: m };
}

// ── Andamiaje ──────────────────────────────────────────────────────────────
let fallas = 0, oks = 0;
const check = (cond, que, detalle) => {
  if (cond) { oks++; console.log(` ok   ${que}${detalle ? `  ·  ${detalle}` : ''}`); }
  else { fallas++; console.log(`FALLA  ${que}${detalle ? `  ·  ${detalle}` : ''}`); }
};

(async () => {
  // ── §1 y §2 · lo rechazado devuelve false y deja constancia ──────────────
  console.log('\n── Una escritura rechazada: ni lanza, ni se calla ──');
  for (const [nombre, invocar] of [
    ['fsSet',  (a) => a.fsSet('obras/0114/config/info', { x: 1 })],
    ['fsDel',  (a) => a.fsDel('obras/0114/config/info')],
    ['fsSetA', (a) => a.fsSetA('obras/0114/config/info', { x: 1 }, { modulo: 'contrato' })],
  ]) {
    const a = montar({ falla: true, prefijo: 'orgs/coatza' });
    let r, lanzo = false;
    try { r = await invocar(a); } catch { lanzo = true; }

    check(!lanzo, `\`${nombre}\` no lanza cuando las reglas niegan`,
      lanzo ? 'lanzó — eso le tumba la captura al usuario por un guardado de fondo'
            : 'devolvió en vez de lanzar');
    check(r === false, `\`${nombre}\` devuelve false, no un neutro creíble`,
      `devolvió ${JSON.stringify(r)}`);

    const perdidas = a.escriturasPerdidas();
    check(perdidas.length === 1,
      `\`${nombre}\` deja UNA constancia de lo que no se guardó`,
      `${perdidas.length} en el canal`);
    if (perdidas.length === 1) {
      check(perdidas[0].ruta === 'orgs/coatza/obras/0114/config/info',
        `\`${nombre}\` anota la ruta YA PREFIJADA, que es la que se intentó`,
        perdidas[0].ruta);
      check(perdidas[0].codigo === 'permission-denied',
        `\`${nombre}\` anota el código con el que se negó`,
        perdidas[0].codigo);
    } else {
      fallas += 2;
      console.log(`FALLA  \`${nombre}\` anota la ruta YA PREFIJADA  ·  no hay fila que mirar`);
      console.log(`FALLA  \`${nombre}\` anota el código  ·  no hay fila que mirar`);
    }
  }

  // ── §3 · lo que sí queda no ensucia el canal ─────────────────────────────
  console.log('\n── Una escritura que sí queda no avisa de nada ──');
  for (const [nombre, invocar] of [
    ['fsSet',  (a) => a.fsSet('obras/0114/config/info', { x: 1 })],
    ['fsDel',  (a) => a.fsDel('obras/0114/config/info')],
    ['fsSetA', (a) => a.fsSetA('obras/0114/config/info', { x: 1 }, { modulo: 'contrato' })],
  ]) {
    const a = montar({ falla: false, prefijo: 'orgs/coatza' });
    const r = await invocar(a);
    check(r === true, `\`${nombre}\` devuelve true cuando la escritura queda`,
      `devolvió ${JSON.stringify(r)}`);
    check(a.escriturasPerdidas().length === 0,
      `\`${nombre}\` no avisa de una pérdida que no hubo`,
      `${a.escriturasPerdidas().length} en el canal — un aviso que sale siempre deja de avisar`);
  }

  // ── §4 · el canal entrega y se vacía ─────────────────────────────────────
  console.log('\n── El canal entrega a quien escucha, y se puede vaciar ──');
  {
    const a = montar({ falla: true, prefijo: null });
    const recibido = [];
    const dejarDeEscuchar = a.alPerderseUnaEscritura((lista) => recibido.push(lista));

    await a.fsSet('obras/0114/avance/historial', { semanas: [] });
    check(recibido.length === 1,
      'quien escucha se entera en cuanto se pierde una escritura',
      `${recibido.length} aviso(s)`);
    check(recibido[0]?.length === 1 &&
          recibido[0][0].ruta === 'obras/0114/avance/historial',
      'y lo que recibe trae la ruta de la que se perdió',
      recibido[0]?.[0]?.ruta || '(nada)');

    a.olvidarEscriturasPerdidas();
    check(a.escriturasPerdidas().length === 0,
      'el usuario puede dar por leída la franja y el canal queda limpio',
      `${a.escriturasPerdidas().length} quedaron`);

    dejarDeEscuchar();
    await a.fsSet('obras/0114/avance/historial', { semanas: [] });
    check(recibido.length === 2,
      'y quien se dio de baja deja de recibir',
      `${recibido.length} avisos en total (1 de la pérdida + 1 del vaciado, ` +
      'ninguno de la pérdida posterior a la baja)');
  }

  // ── §5 · ninguna pantalla afirma «Guardado» sin mirar ────────────────────
  //
  // Esto se mide sobre el AST y no ejecutando, porque lo que se afirma es de
  // la FORMA del camino: que entre la escritura y la frase «Guardado» haya
  // una condición. Ejecutar cada pantalla pediría montar React entero para
  // volver a comprobar lo mismo.
  //
  // La regla, en una línea: si una función escribe con un helper BLANDO —de
  // los que devuelven `false` en vez de lanzar—, su bandera de «guardado» no
  // puede encenderse incondicionalmente.
  //
  // Se exige la condición y no «que el resultado se asigne»: guardarlo en un
  // `const` que nadie lee miente exactamente igual. Las escrituras ESTRICTAS
  // (`fsSetAEstricto`) no cuentan, y es correcto: ésas lanzan, así que el
  // `catch` ya es la condición.
  console.log('\n── Nadie dice «Guardado» sin haber consultado el resultado ──');
  {
    const BLANDAS = new Set(['fsSet', 'fsDel', 'fsSetA', 'fsDelA']);
    const BANDERAS = new Set(['setSaved', 'setGuardado']);
    const mentiras = [];

    traverse(ast, {
      CallExpression(p) {
        const c = p.node.callee;
        if (c.type !== 'Identifier' || !BANDERAS.has(c.name)) return;
        const arg = p.node.arguments[0];
        if (!arg || arg.type !== 'BooleanLiteral' || arg.value !== true) return;

        // ¿Está bajo alguna condición? Un `if` entre la escritura y la frase
        // es la forma de haber mirado.
        let bajoCondicion = false;
        const fn = p.getFunctionParent();
        let q = p;
        while (q && q !== fn) {
          if (q.isIfStatement() || q.isConditionalExpression() ||
              q.isLogicalExpression()) { bajoCondicion = true; break; }
          q = q.parentPath;
        }
        if (bajoCondicion || !fn) return;

        // Sin condición: entonces su función no puede haber escrito con un
        // helper blando.
        const blandas = [];
        fn.traverse({
          CallExpression(w) {
            const wc = w.node.callee;
            if (wc.type === 'Identifier' && BLANDAS.has(wc.name)) {
              blandas.push(`${wc.name} L${w.node.loc.start.line}`);
            }
          },
        });
        if (blandas.length) {
          mentiras.push(`${c.name}(true) en L${p.node.loc.start.line} ` +
            `después de ${blandas.join(', ')}`);
        }
      },
    });

    check(mentiras.length === 0,
      'ninguna bandera de «guardado» se enciende tras una escritura cuyo resultado se tiró',
      mentiras.length ? mentiras.join(' · ') : 'ninguna');
  }

  console.log('');
  console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
  if (fallas > 0) {
    console.log('');
    console.log('Una escritura que no quedó y nadie ve es el defecto que le costó a la');
    console.log('0114 siete cierres semanales. Si esto está rojo, volvió a ser posible.');
  }
  process.exit(fallas > 0 ? 1 : 0);
})();
