#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL ESTADO DE UNA OBRA SE GUARDA, O NO SE PROMETE
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ DEFECTO CIERRA. «Archivar» no archivaba. Escribía un retrato en
// `global/historial_obras` y después `setObras(...)`, que es estado de React:
// duraba lo que durara la pestaña. Medido en producción el 2026-11-10 con
// `medir-que-hace-archivar-una-obra.cjs` (sólo lectura): las 7 obras vivas
// traen `estado: "activa"` guardado y NINGUNA trae `"archivada"`. Y los 8
// retratos del historial son 4 pares DUPLICADOS de dos obras demo —SCT01 y
// MUN01, archivadas cuatro veces cada una en mayo—, que es la huella de
// alguien dándole al botón otra vez porque la obra había vuelto sola. El
// comentario del propio archivo lo confesaba y nadie lo había podido correr.
//
// LA TRAMPA QUE HACE FALTA NOMBRAR, Y QUE ES EL CENTRO DE ESTE BANCO. El
// estado vive duplicado en dos documentos: `obras/{id}` —el que lista el
// portafolio— y `obras/{id}/config/info`. Al hidratar, el merge es
// `{...o, ...info}`, así que **`config/info` LE GANA a la raíz**. Un arreglo
// que escriba sólo la raíz se ve perfecto al probarlo a mano —la obra queda
// cerrada, se recarga el componente y sigue cerrada— y se revierte solo en el
// siguiente login, sin un error, sin una franja, sin nada. Es el MISMO defecto
// en su única versión invisible. Por eso §1 afirma las DOS rutas, no una.
//
// QUÉ AFIRMA. No que exista un símbolo. Extrae `guardarEstadoDeObra` de
// `src/App.jsx` y la EJECUTA con un escritor de mentira que anota a qué ruta le
// tocó qué, así que lo que se comprueba es la decisión completa: las dos rutas,
// en qué orden, con qué sello, y qué devuelve cuando una de las dos se cae. Y
// extrae el bloque de la TARJETA de obra buscándolo por lo que dice en pantalla
// —«Ver obra →»—, lo compila y lo renderiza: la insignia, el renglón del sello
// y qué botones se ofrecen salen del HTML, no de leer el JSX.
//
// POR QUÉ EL ESCRITOR LLEGA POR PARÁMETRO. Porque es la única manera de que
// esto sea comprobable sin montar Firebase. No es ceremonia: es que «se
// escriben los dos documentos» era precisamente lo que nadie podía afirmar.
//
// LO QUE NO ENTRA AQUÍ. Que una obra cerrada RECHACE capturas: eso no lo
// sostiene la pantalla, lo sostiene `firestore.rules`, y se prueba contra el
// emulador en su propio banco. Un botón que no se pinta no es un candado.
//
// Uso:
//     node scripts/prueba-el-estado-de-la-obra-se-guarda.cjs
//     node scripts/prueba-el-estado-de-la-obra-se-guarda.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const archivo = process.env.ARCHIVO_APP || ARCHIVO;

const PEDIDOS = ['guardarEstadoDeObra', 'ESTADOS_DE_OBRA', 'selloDeEstadoLegible',
  'fraseObrasDelTablero',
  'calcularKPIsObra', 'presentacionEconomiaObra', 'resolverNombreCortoObra',
  'C', 'alfa', 'MXN', 'NUM'];

// ── LO QUE SE VA A EJECUTAR, SACADO DEL ARCHIVO ────────────────────────────
// La fuente la trae `fuenteDe` con su cierre transitivo. Una lista de
// dependencias tecleada a mano es lo que dejó cuatro bancos muertos en octubre.
//
// Van los DOS trozos porque la decisión vive en dos sitios y los dos se mutan:
// la regla, que son símbolos de nivel superior, y el archivo entero, de donde
// sale el bloque de la tarjeta y el mapa de colores —que viven DENTRO de
// `PantallaObras` y por eso `fuenteDe` no los alcanza—.
const SRC = fs.readFileSync(archivo, 'utf8');
const { cuerpo: CUERPO, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length && !process.env.ARCHIVO_APP) noArranco(faltan, path.basename(archivo));

const regla = (cuerpo) =>
  new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── EL BLOQUE DE LA TARJETA ────────────────────────────────────────────────
// Se busca por lo que la tarjeta DICE —«Ver obra →»— y no por el nombre de una
// variable: el día que alguien renombre `o` o `col`, la prueba tiene que seguir
// mirando esta tarjeta. Y se exige UNA sola coincidencia: con dos, el banco
// estaría pintando cualquiera de las dos y no sabría cuál. Eso no es rojo, es
// que el ancla dejó de identificar el bloque — es la lección del 2026-11-09,
// cuando un ancla por texto cazó `generarPDFObra` en vez del tablero.
function bloqueDeTarjeta(src) {
  const hallados = [];
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    ArrowFunctionExpression(p) {
      if (p.node.params.length !== 1) return;
      const txt = src.slice(p.node.start, p.node.end);
      if (!txt.includes('Ver obra →')) return;
      if (!txt.includes('selloDeEstadoLegible(')) return;
      hallados.push(txt);
    },
  });
  if (hallados.length !== 1) {
    console.error('\nNO ARRANCÓ: se esperaba UN bloque de tarjeta de obra y se hallaron ' +
      hallados.length + '.');
    console.error('Se busca la función de un argumento que pinta «Ver obra →» y llama');
    console.error('a `selloDeEstadoLegible`. Si la tarjeta se reescribió, arregla el ancla.');
    process.exit(2);
  }
  return hallados[0];
}

// Los componentes de mentira dejan rastro legible y nada más: lo que se afirma
// es el TEXTO y el color que les llegó, no la forma del árbol. `Bdg` escupe su
// color en un atributo justamente para poder afirmar que `ec` eligió bien.
const Bdg = ({ children, color }) =>
  React.createElement('span', { 'data-insignia': String(color) }, children);

function pintar(api, bloque, ec, { obra, usuario, dep = false, puedeGestionar = true,
  puedeEliminar = false }) {
  const js = esbuild.transformSync(`(${bloque})`, { loader: 'jsx' }).code;
  const nombres = ['React', 'C', 'alfa', 'MXN', 'NUM', 'Bdg', 'calcularKPIsObra',
    'presentacionEconomiaObra', 'resolverNombreCortoObra', 'selloDeEstadoLegible',
    'datosPorObra', 'gpData', 'dep', '_ne', 'ec', 'usuario', 'puedeGestionar',
    'puedeEliminar', 'cerrar', 'reabrir', 'setConfirmarArchivar', 'iniciarEliminar',
    'onSelect'];
  const valores = [React, api.C, api.alfa, api.MXN, api.NUM, Bdg,
    api.calcularKPIsObra, api.presentacionEconomiaObra, api.resolverNombreCortoObra,
    api.selloDeEstadoLegible,
    {}, null, dep, (s) => (s || '').toLowerCase(), ec, usuario, puedeGestionar,
    puedeEliminar, () => {}, () => {}, () => {}, () => {}, () => {}];
  const fn = new Function(...nombres, `return ${js}`)(...valores);
  try {
    return renderToStaticMarkup(fn(obra));
  } catch (e) {
    // Un render que revienta es ROJO, no «no arrancó»: en pantalla no sale un
    // número mal, no sale NADA. Armar el bloque sí es andamiaje y sube a 2.
    return `LA TARJETA SE CAYO AL PINTARSE: ${e.message}`;
  }
}

// El mapa `ec` se declara dentro de `PantallaObras`, así que `fuenteDe` no lo
// alcanza. Se saca del texto y se EVALÚA con la paleta viva, que es distinto de
// copiarlo: si alguien le quita `cerrada`, aquí llega sin `cerrada`.
function mapaDeColores(src, api) {
  const m = src.match(/const ec=\{([^}]*)\};/);
  if (!m) {
    console.error('\nNO ARRANCÓ: no se halló el mapa `ec` de colores de estado.');
    process.exit(2);
  }
  return new Function('C', `return {${m[1]}};`)(api.C);
}

const USUARIO = { correo: 'ana@fosmon.com.mx', nombre: 'Ana Rivera',
  rol: 'director_operaciones' };
const OBRA = { id: '0112', nombre: 'Malecón de Coatzacoalcos',
  contrato: 'SIOP-0112', presupuesto: 100_000_000, estado: 'activa',
  superintendente: 'J. Luna' };
const AHORA = '2026-11-10T21:45:00.000Z';

function correr(cuerpo, src) {
  const api = regla(cuerpo);
  const bloque = bloqueDeTarjeta(src);
  const mapa = mapaDeColores(src, api);
  const fallos = [];
  const check = (ok, que, detalle = '') => {
    if (ok) { if (!process.env.CALLADO) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!process.env.CALLADO) console.log(`  FALLA ${que}\n        ${detalle}`);
  };

  // Escritor de mentira: anota ruta y carga, y puede fallar en la ruta que se
  // le diga. Es lo único que hace ejecutable «se escriben los dos».
  const escritor = (rutaQueFalla = null) => {
    const hechas = [];
    const f = async (ruta, datos, ctx) => {
      hechas.push({ ruta, datos, ctx });
      return !(rutaQueFalla && ruta === rutaQueFalla);
    };
    f.hechas = hechas;
    return f;
  };

  return (async () => {
  // ══ §1 · LOS DOS DOCUMENTOS, SIEMPRE ══════════════════════════════════════
  if (!process.env.CALLADO) console.log('\n§1 · un cambio de estado escribe los DOS documentos');

  const esc = escritor();
  const r = await api.guardarEstadoDeObra(OBRA, 'cerrada', USUARIO, AHORA, esc);
  const rutas = esc.hechas.map((h) => h.ruta);

  check(rutas.includes('obras/0112/config/info'),
    'escribe `obras/{id}/config/info`, que es el documento que GANA al hidratar',
    `escribió ${JSON.stringify(rutas)}`);
  check(rutas.includes('obras/0112'),
    'escribe `obras/{id}`, que es el documento que lista el portafolio',
    `escribió ${JSON.stringify(rutas)}`);
  check(rutas.length === 2, 'y nada más: dos escrituras, no tres',
    `escribió ${JSON.stringify(rutas)}`);
  check(rutas[0] === 'obras/0112/config/info',
    '`config/info` va PRIMERO: si sólo entra una, que entre la que decide',
    `el orden fue ${JSON.stringify(rutas)}`);

  // El sello en LOS DOS. Si la raíz llevara la fecha y `info` no, el merge de
  // la hidratación la borraría y la obra quedaría cerrada sin decir cuándo.
  for (const { ruta, datos } of esc.hechas) {
    check(datos.estado === 'cerrada', `${ruta} lleva el estado nuevo`,
      `llevó ${JSON.stringify(datos.estado)}`);
    check(datos.estadoDesde === AHORA, `${ruta} lleva CUÁNDO`,
      `llevó ${JSON.stringify(datos.estadoDesde)}`);
    check(datos.estadoPor === 'ana@fosmon.com.mx', `${ruta} lleva QUIÉN`,
      `llevó ${JSON.stringify(datos.estadoPor)}`);
    check(datos.estadoPorNombre === 'Ana Rivera', `${ruta} lleva el nombre de quién`,
      `llevó ${JSON.stringify(datos.estadoPorNombre)}`);
  }
  const raiz = esc.hechas.find((h) => h.ruta === 'obras/0112');
  check(raiz && raiz.datos.id === '0112',
    'la raíz lleva su `id`: sin él la obra no es listable y desaparece de la lista',
    `llevó ${JSON.stringify(raiz && raiz.datos.id)}`);
  check(esc.hechas.every((h) => h.ctx && h.ctx.obraId === '0112'
        && /cerrada/.test(String(h.ctx.entidad))),
    'las dos van con contexto de auditoría que nombra la obra y el estado nuevo',
    JSON.stringify(esc.hechas.map((h) => h.ctx)));

  // ══ §2 · SI UNA ESCRITURA SE CAE, NO SE DICE QUE QUEDÓ ════════════════════
  if (!process.env.CALLADO) console.log('\n§2 · media escritura no es un cierre');

  check(r && r.ok === true, 'con las dos escrituras dentro, el cambio queda',
    JSON.stringify(r));
  for (const ruta of ['obras/0112/config/info', 'obras/0112']) {
    const e2 = escritor(ruta);
    const r2 = await api.guardarEstadoDeObra(OBRA, 'cerrada', USUARIO, AHORA, e2);
    check(r2 && r2.ok === false, `si se cae ${ruta}, el cambio NO queda`,
      JSON.stringify(r2));
    check(e2.hechas.length === 2,
      `  y aun así se intentó la otra: perder una no cancela la que sí puede entrar`,
      `intentó ${e2.hechas.length}`);
  }

  // ══ §3 · UN ESTADO QUE NO EXISTE NO SE ESCRIBE ════════════════════════════
  if (!process.env.CALLADO) console.log('\n§3 · el vocabulario de estados es cerrado');

  for (const malo of ['terminada', 'CERRADA', 'finalizada', '', null, undefined]) {
    const e3 = escritor();
    const r3 = await api.guardarEstadoDeObra(OBRA, malo, USUARIO, AHORA, e3);
    check(r3 === null && e3.hechas.length === 0,
      `«${String(malo)}» no es un estado de obra: no se escribe nada`,
      `devolvió ${JSON.stringify(r3)} tras ${e3.hechas.length} escritura(s)`);
  }
  const e4 = escritor();
  check(await api.guardarEstadoDeObra({ nombre: 'sin id' }, 'cerrada', USUARIO, AHORA, e4) === null
        && e4.hechas.length === 0,
    'una obra sin `id` no se escribe: la ruta sería `obras/undefined`');
  check(api.ESTADOS_DE_OBRA.includes('cerrada'),
    '`cerrada` es parte del vocabulario, no un estado improvisado en un botón');

  // ══ §4 · EL CIERRE DICE DESDE CUÁNDO Y POR QUIÉN ══════════════════════════
  if (!process.env.CALLADO) console.log('\n§4 · la frase del sello: tres estados, tres cosas distintas');

  // `r?.info` y no `r.info`: una mutación que saque `cerrada` del vocabulario
  // devuelve `null`, y reventar aquí convertiría un ROJO legítimo —ya mordido
  // en §1— en un NO ARRANCÓ, que es decir «no se pudo medir» cuando sí se midió.
  const cerrada = { ...OBRA, estado: 'cerrada', ...(r?.info || {}) };
  const frase = api.selloDeEstadoLegible(cerrada);
  check(/Cerrada/.test(frase), 'una obra cerrada dice que está cerrada', `dijo «${frase}»`);
  check(/10\/11\/2026/.test(frase), '  y el día en que se cerró, en el calendario de la obra',
    `dijo «${frase}»`);
  check(/Ana Rivera/.test(frase), '  y quién la cerró', `dijo «${frase}»`);

  // Las obras que YA estaban archivadas antes de este cambio no tienen sello:
  // `archivar` nunca lo escribió. Ésas lo dicen. Callarse sería dejar que una
  // obra sin registro se viera igual que una con registro.
  const vieja = api.selloDeEstadoLegible({ ...OBRA, estado: 'archivada' });
  check(/Archivada/.test(vieja) && /sin registro/.test(vieja),
    'una obra archivada sin sello DICE que no hay registro de cuándo ni por quién',
    `dijo «${vieja}»`);
  check(vieja !== api.selloDeEstadoLegible({ ...OBRA, estado: 'archivada',
    estadoDesde: AHORA, estadoPorNombre: 'Ana Rivera' }),
    '  y no se lee igual que una archivada que sí tiene registro');

  const ilegible = api.selloDeEstadoLegible({ ...OBRA, estado: 'cerrada',
    estadoDesde: '5/11/2026, 8:01:04 a.m.', estadoPorNombre: 'Ana Rivera' });
  check(!/Invalid Date/.test(ilegible) && !/5\/11\/2026,/.test(ilegible),
    'con una fecha ilegible no se imprime «Invalid Date» ni diez letras que se lean como fecha',
    `dijo «${ilegible}»`);
  check(/ilegible/.test(ilegible) && /Ana Rivera/.test(ilegible),
    '  se dice que la fecha no se puede leer, y no se pierde quién',
    `dijo «${ilegible}»`);

  // Una obra activa no tiene nada que sellar: el sello es la noticia de que
  // algo se detuvo, y una obra andando no es noticia.
  for (const e of ['activa', 'pausada', undefined]) {
    check(api.selloDeEstadoLegible({ ...OBRA, estado: e }) === '',
      `una obra «${String(e)}» no pinta renglón de sello`);
  }

  // ══ §5 · EL CIERRE SE NOTA EN LA TARJETA ══════════════════════════════════
  if (!process.env.CALLADO) console.log('\n§5 · la tarjeta, renderizada');

  const html = (obra, extra = {}) =>
    pintar(api, bloque, mapa, { obra, usuario: USUARIO, ...extra });

  const hC = html(cerrada);
  check(/CERRADA/.test(hC), 'la insignia de una obra cerrada dice CERRADA', hC.slice(0, 200));
  check(/Cerrada el 10\/11\/2026 · Ana Rivera/.test(hC),
    'y debajo, el renglón que dice desde cuándo y por quién');
  // Con `includes` y no con una regular: el color es `var(--c-blueDk)`, y ese
  // paréntesis abre un grupo. La regular pasaba por casualidad.
  check(hC.includes(`data-insignia="${mapa.cerrada}"`)
        && mapa.cerrada !== mapa.archivada && mapa.cerrada !== mapa.activa,
    'con un color propio: cerrada no se ve como archivada ni como activa',
    `cerrada=${mapa.cerrada} archivada=${mapa.archivada} activa=${mapa.activa}`);

  const hA = html({ ...OBRA, estado: 'activa' });
  check(!/Cerrada/.test(hA) && !/Archivada/.test(hA),
    'una obra activa no pinta ningún renglón de sello');

  // ══ §6 · CERRADA NO ES ARCHIVADA ══════════════════════════════════════════
  if (!process.env.CALLADO) console.log('\n§6 · cerrada sigue en el tablero; archivada se va al cajón');

  // La propiedad que se pidió: la obra ya no se mueve, pero SIGUE sumando al
  // año. Una obra cerrada que desapareciera de la lista no se podría sumar.
  check(/Ver obra →/.test(hC),
    'una obra cerrada se sigue abriendo: es la condición para poder sumar lo facturado');
  const hAr = html({ ...cerrada, estado: 'archivada' });
  check(!/Ver obra →/.test(hAr), 'una archivada no: ésa sí salió de la vista');

  check(/Cerrar obra/.test(hA), 'a una obra activa se le ofrece cerrarla');
  check(!/Cerrar obra/.test(hC), 'a una ya cerrada no se le vuelve a ofrecer');
  check(/Reabrir/.test(hC) && !/Reactivar/.test(hC),
    'a una cerrada se le ofrece REABRIR');
  check(/Reactivar/.test(hAr) && !/Reabrir/.test(hAr),
    'a una archivada, REACTIVAR: el mismo hecho con el rótulo de su origen');
  check(!/Archivar/.test(hAr) && /Archivar/.test(hC),
    'archivar se sigue ofreciendo sobre una cerrada, y no sobre una ya archivada');

  // El estado de la obra es del constructor. Del lado dependencia, ofrecer el
  // botón sería ofrecerle mover algo que no es suyo.
  const hDep = html(cerrada, { dep: true, puedeGestionar: false });
  check(!/Cerrar obra/.test(hDep) && !/Reabrir/.test(hDep),
    'del lado dependencia no se ofrece mover el estado de la obra');
  check(/CERRADA/.test(hDep) && /Cerrada el 10\/11\/2026/.test(hDep),
    '  pero el cierre SÍ se le nota: saber que está cerrada no es un privilegio');

  // ══ §7 · EL RÓTULO NO LLAMA ACTIVA A UNA OBRA CERRADA ════════════════════
  if (!process.env.CALLADO) console.log('\n§7 · «3 obras activas» con una cerrada era una afirmación falsa');

  const F = api.fraseObrasDelTablero;
  const A = (estado) => ({ id: estado + Math.random(), estado });

  check(F([A('activa'), A('activa'), A('activa')]) === '3 obras activas',
    'sin ninguna cerrada, el rótulo sigue diciendo lo que decía',
    `dijo «${F([A('activa'), A('activa'), A('activa')])}»`);
  const mixta = F([A('activa'), A('activa'), A('cerrada')]);
  check(!/activa/.test(mixta),
    'con una cerrada entre tres, el rótulo NO dice «activas»', `dijo «${mixta}»`);
  check(/^3 obras/.test(mixta),
    '  y la cuenta sigue siendo 3: la cerrada no sale del tablero', `dijo «${mixta}»`);
  check(/1 cerrada/.test(mixta), '  y dice cuántas están cerradas', `dijo «${mixta}»`);
  check(F([A('cerrada'), A('cerrada')]) === '2 obras cerradas',
    'si todas están cerradas, lo dice sin rodeos',
    `dijo «${F([A('cerrada'), A('cerrada')])}»`);
  check(F([A('activa')]) === '1 obra activa' && F([A('cerrada')]) === '1 obra cerrada',
    'en singular no dice «1 obras»',
    `dijo «${F([A('activa')])}» y «${F([A('cerrada')])}»`);
  check(F([]) === '0 obras activas' && F(null) === '0 obras activas',
    'sin obras no revienta ni inventa un número');

  return fallos;
  })();
}

// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Cada mutación es la manera en que esto estaba escrito antes, o una manera
// plausible de volver a escribirlo. Si alguna sobrevive, las aserciones de
// arriba están de adorno.
const MUTACIONES = [
  ['vuelve a escribir sólo la raíz: el cierre se revierte en el siguiente login',
    "  const okInfo = await escribir(`obras/${obra.id}/config/info`, info, ctx);",
    '  const okInfo = true;'],
  ['vuelve a escribir sólo `config/info`: el portafolio lista el estado viejo',
    '  const okRaiz = await escribir(`obras/${obra.id}`, { id: obra.id, ...info }, ctx);',
    '  const okRaiz = true;'],
  ['la raíz va primero: si sólo entra una, entra la que NO decide',
    `  const okInfo = await escribir(\`obras/\${obra.id}/config/info\`, info, ctx);`,
    `  const okRaiz0 = await escribir(\`obras/\${obra.id}\`, { id: obra.id, ...info }, ctx);
  const okInfo = okRaiz0;`],
  ['media escritura se reporta como cierre consumado',
    '  return { ok: !!(okInfo && okRaiz), estado, info };',
    '  return { ok: !!(okInfo || okRaiz), estado, info };'],
  ['el sello se queda en la raíz y `config/info` sólo lleva el estado',
    '  const okInfo = await escribir(`obras/${obra.id}/config/info`, info, ctx);',
    '  const okInfo = await escribir(`obras/${obra.id}/config/info`, { estado }, ctx);'],
  ['la raíz pierde su `id` y la obra deja de ser listable',
    '{ id: obra.id, ...info }',
    '{ ...info }'],
  ['el estado se escribe sin preguntar si existe: «finalizada» entra igual',
    "  if (!obra?.id || !ESTADOS_DE_OBRA.includes(estado)) return null;",
    '  if (!obra?.id) return null;'],
  ['`cerrada` sale del vocabulario y vuelve a ser un estado improvisado',
    "const ESTADOS_DE_OBRA = ['activa', 'pausada', 'cerrada', 'archivada'];",
    "const ESTADOS_DE_OBRA = ['activa', 'pausada', 'archivada'];"],
  ['el sello deja de decir quién',
    "    estadoPor: usuario?.correo || usuario?.email || '',",
    "    estadoPor: '',"],
  ['las escrituras pierden el contexto de auditoría: ya no queda registrado',
    "  const ctx = { modulo: 'obras', entidad: `estado → ${estado}`,\n                obraId: obra.id, obraNombre: obra.contrato || obra.nombre };",
    '  const ctx = undefined;'],
  ['una obra archivada sin registro se calla y se ve igual que una con registro',
    "  if (!obra.estadoDesde) return `${verbo} sin registro de cuándo ni por quién`;",
    "  if (!obra.estadoDesde) return verbo;"],
  ['la fecha del sello vuelve a imprimirse sin preguntar si se puede leer',
    "  const d = instanteGuardado(obra.estadoDesde);\n  if (!d) return `${verbo}, con fecha ilegible${sufijo}`;",
    '  const d = new Date(obra.estadoDesde);'],
  ['el cierre vuelve a ser sólo una etiqueta: la insignia sin el renglón del sello',
    '{sello && <span style={{fontSize:9,color:col,fontWeight:600,textAlign:"right"}}>{sello}</span>}',
    ''],
  ['cerrada se pinta del mismo gris que archivada: terminar una obra se ve como guardarla',
    'cerrada:C.blueDk,archivada:C.textMut',
    'cerrada:C.textMut,archivada:C.textMut'],
  ['cerrada se trata como archivada y sale del tablero: ya no se puede sumar al año',
    '      const archivada=o.estado==="archivada";',
    '      const archivada=o.estado==="archivada"||o.estado==="cerrada";'],
  ['se le vuelve a ofrecer «Cerrar obra» a una obra ya cerrada',
    'puedeGestionar&&!archivada&&!cerrada&&<button',
    'puedeGestionar&&!archivada&&<button'],
  ['una obra cerrada no se puede reabrir: queda sin salida',
    'puedeGestionar&&(archivada||cerrada)&&<button',
    'puedeGestionar&&archivada&&<button'],
  ['el rótulo vuelve a llamar activas a todas las del tablero, cerradas incluidas',
    "  if (!cerradas) return `${n} obra${s} activa${s}`;",
    '  if (true) return `${n} obra${s} activa${s}`;'],
  ['el rótulo deja fuera de la cuenta a las cerradas: ya no se pueden sumar',
    '  const n = lista.length;',
    "  const n = lista.filter((o) => o?.estado !== 'cerrada').length;"],
];

(async () => {
if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!SRC.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 110)}`);
      process.exit(2);
    }
    // Una mutación que pega en dos sitios muta uno y deja el otro, y entonces
    // lo que se midió no es lo que dice el título.
    if (SRC.indexOf(de) !== SRC.lastIndexOf(de)) {
      console.error(`NO ARRANCÓ: el anclaje de «${titulo}» aparece más de una vez`);
      process.exit(2);
    }
    // Se muta el archivo SIEMPRE y la regla extraída cuando el anclaje cae
    // dentro de ella. Mutar sólo uno de los dos dejaría una copia intacta del
    // trozo mutado, y entonces la mutación mediría la copia sana.
    let fallos;
    process.env.CALLADO = '1';
    try {
      fallos = await correr(CUERPO.includes(de) ? CUERPO.replace(de, a) : CUERPO,
                            SRC.replace(de, a));
    }
    catch (e) {
      // Reventar NO es salir en rojo: mide que el taller sabe parsear, no que
      // la aserción muerda. Contarlo como ROJO deja pasar mutaciones que en
      // realidad nadie detecta, así que es NO ARRANCÓ, que es un 2.
      console.error(`NO ARRANCÓ: la mutación «${titulo}» revienta el trozo ` +
                    `en vez de romper la semántica: ${e.message}`);
      process.exit(2);
    }
    delete process.env.CALLADO;
    if (fallos.length) {
      console.log(`   ✓ ROJO  ${titulo}  ·  ${fallos.length} aserción(es) mordieron`);
      console.log(`           la primera: ${fallos[0]}`);
    } else {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      sobrevivieron++;
    }
  }
  if (sobrevivieron) {
    console.error(`\nROJO: ${sobrevivieron} mutación(es) sobrevivieron. Las aserciones no muerden.`);
    process.exit(1);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.`);
  process.exit(0);
}

console.log('EL ESTADO DE UNA OBRA SE GUARDA, O NO SE PROMETE');
const fallos = await correr(CUERPO, SRC);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
})();
