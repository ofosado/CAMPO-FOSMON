#!/usr/bin/env node
// Siembra el EMULADOR con dos organizaciones para poder mirar la app con los
// ojos de cada una, una al lado de la otra.
//
//   · fosmon        tipo constructora   — obras en la raíz, como en producción
//   · coatzacoalcos tipo dependencia    — obras bajo orgs/coatzacoalcos/obras
//
// Para qué. La conducta ya la comprueba `prueba-ui-dependencia.cjs`, que es lo
// que para un merge. Esto es otra cosa: es poder VER que el tablero de FOSMON
// quedó igual y que el del municipio no tiene margen. Una prueba dice que la
// cifra no se calcula; sólo la pantalla dice si lo que queda se entiende.
//
// NUNCA toca producción. Escribe únicamente contra 127.0.0.1 y aborta si la
// variable del emulador no está puesta — un guion de siembra apuntando a
// producción por accidente es exactamente el tipo de daño que no se deshace.
//
// El proyecto es `campo-fosmon`, el mismo de producción, y eso es a propósito:
// la entrada del preview reusa TAL CUAL el `firebaseConfig` de App.jsx —si
// cambiara el projectId, `initializeApp` reventaría por configuración
// duplicada distinta—. No hay riesgo: el navegador llama
// `connectFirestoreEmulator`/`connectAuthEmulator` antes de la primera
// operación, y esos conectores no tienen regreso a producción.
//
// Uso:
//   firebase emulators:start --only firestore,auth --project campo-fosmon
//   node scripts/sembrar-preview-emulador.cjs

// La versión del parser se LEE de `functions/index.js`, no se teclea aquí. Era
// la tercera copia del mismo número —las otras dos están en
// `functions/index.js` y `src/App.jsx`— y al subirla a 4 el preview se habría
// quedado en «caché de versión vieja», con la pantalla de Gastos en blanco y
// la culpa aparentemente en la pantalla. Si el día de mañana no se encuentra,
// se aborta: sembrar una versión inventada deja el preview mudo.
const versionDeFunciones = (nombre, consecuencia) => {
  const txt = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  const m = txt.match(new RegExp(`^const ${nombre} = (\\d+);`, 'm'));
  if (!m) {
    console.error(`No se encontró \`${nombre}\` en functions/index.js.\n` +
      `Sin ese número ${consecuencia}\n` +
      'Se aborta antes de escribir nada.');
    process.exit(2);
  }
  return Number(m[1]);
};
const PARSER_VERSION = versionDeFunciones('PARSER_VERSION',
  'la semilla deja el preview en «versión vieja» y la pantalla de Gastos sin cifras.');
// Y la del catálogo, por lo mismo: si no empata, el alta de obra descarta el
// catálogo sembrado y vuelve a ofrecer sólo las obras que YA están en CAMPO —
// que es exactamente el defecto que el catálogo viene a cerrar.
const CATALOGO_GP_VERSION = versionDeFunciones('CATALOGO_GP_VERSION',
  'el alta de obra descarta el catálogo y el preview no puede probar el defecto.');

const HOST = '127.0.0.1';
const PUERTO_FS = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon';
const LLAVE = 'fake-api-key';

// Las contraseñas son de mentira y viven aquí, en el guion, a propósito: son
// parte de la semilla y no de la memoria de nadie. El emulador se borra al
// apagarlo.
const CLAVE = 'demo1234';

// La tercera no es de ninguna organización, y eso es el punto: `soporte` es
// la sesión de plataforma. Sus claims llevan `orgId: null` y `tipo: null`
// —así se los escribe `aplicarClaimsUsuario`— y su perfil tampoco lleva
// `orgId`. Sembrarle una organización "para que funcione" sería sembrar el
// caso que la app rechaza a propósito.
// La cuarta es la que faltaba para poder MIRAR el caso del auditor. El auditor
// es un externo —hoy son cuentas de @hytorc.com.mx y @noleaks.com.mx— con
// `todas_obras:false` y, a la vez, con panel consolidado. Hasta ahora las tres
// cuentas sembradas tenían `obras_asignadas: []`, así que la única pregunta que
// importa de ese rol —¿el consolidado suma SÓLO sus obras?— no se podía ver en
// pantalla: con cero asignadas, una lista filtrada y una sin filtrar se ven
// igual de vacías. Se le asigna UNA de las dos obras de constructora a
// propósito: el defecto se vería como una obra de más, y con una sola obra
// sembrada no habría obra de más que ver.
const CUENTAS = [
  { correo: 'demo@fosmon.com.mx', nombre: 'Demo FOSMON',
    rol: 'director_general', tipo: 'constructora', orgId: 'fosmon' },
  { correo: 'oscar@cotea.com.mx', nombre: 'Oscar Fosado',
    rol: 'director_obras', tipo: 'dependencia', orgId: 'coatzacoalcos' },
  { correo: 'soporte@cotea.com.mx', nombre: 'Soporte cotea',
    rol: 'soporte', tipo: null, orgId: null },
  { correo: 'auditor@hytorc.com.mx', nombre: 'Auditor Hytorc',
    rol: 'auditor', tipo: 'constructora', orgId: 'fosmon', obras: ['0114'] },
  // La quinta es el caso que no se podía MIRAR: `contralor` tiene
  // `todas_obras:true` y NO está en `ROLES_PANEL_EJECUTIVO`, así que recibe la
  // cartera completa y su única herramienta para recorrerla es la lista de
  // tarjetas. Es el rol para el que se ordenó la lista por atraso, y sin una
  // cuenta suya ese orden sólo se podía comprobar en un banco: con el director
  // de obras la lista de tarjetas ya ni se pinta.
  //
  // Las tres obras de la dependencia sirven de fixture tal como están: dos con
  // cierres suficientes para proyectar y la tercera con uno solo, así que el
  // orden tiene que mandarla al final sin inventarle un cero. Con todas las
  // obras en atraso medible no se vería la mitad que importa.
  { correo: 'contralor@cotea.com.mx', nombre: 'Contraloría Coatzacoalcos',
    rol: 'contralor', tipo: 'dependencia', orgId: 'coatzacoalcos' },
  // La sexta existe por una sola pantalla: el panel de diagnóstico del parser
  // de GP, que sólo ve `admin_sistema`. Sin esta cuenta ese panel NO SE PODÍA
  // ABRIR en el preview, y así estuvo clasificando columnas contra prefijos
  // que el parser no emite —`y_`, `m_`, `w_`— con la columna «tipo» vacía en
  // todos los renglones. Un instrumento que nadie puede encender es como no
  // tenerlo: es el que debía haber delatado la semana en dos columnas.
  { correo: 'sistema@fosmon.com.mx', nombre: 'Admin Sistema',
    rol: 'admin_sistema', tipo: 'constructora', orgId: 'fosmon' },
  // La séptima existe por el mismo motivo que la sexta: el alta de obra del
  // lado constructora la permite `ROLES_ALTA_OBRA_C` —`director_operaciones` y
  // `gerente_construccion`— y NINGUNA de las seis cuentas anteriores tiene uno
  // de esos dos roles. El botón «+ Nueva obra» no se pintaba para nadie, así
  // que el selector de obra de GP que abre ese modal no se podía MIRAR en el
  // preview: es justo el que se quedó corto cuando el gasto dejó de traer las
  // 34 obras de la hoja. Un alta que nadie puede abrir se verifica sola.
  { correo: 'gerencia@fosmon.com.mx', nombre: 'Gerencia de Construcción',
    rol: 'gerente_construccion', tipo: 'constructora', orgId: 'fosmon' },
  // Las tres últimas son UNA CADENA DE MANDO del municipio, y existen por una
  // conducta que sin ellas no se podía mirar: a quién le llega el cierre
  // semanal. Hasta ahora las dos cuentas de dependencia eran `director_obras`
  // y `contralor`, las dos con `todas_obras:true`; el cierre lo cerraba el
  // propio director y el aviso le llegaba a sí mismo, que es justo el caso en
  // el que un ruteo roto y uno bueno se ven iguales.
  //
  // `supervisor_obra` es quien CAPTURA —tiene `captura:"editar"` y
  // `todas_obras:false`—, así que se le asigna una obra: con cero asignadas no
  // llega a la pantalla de avance y no puede cerrar nada. Las otras dos son el
  // mando que tiene que enterarse, y tienen que ser DOS para que se vea que el
  // aviso sube a varios y no a uno.
  { correo: 'supervisor@cotea.com.mx', nombre: 'Laura Méndez',
    rol: 'supervisor_obra', tipo: 'dependencia', orgId: 'coatzacoalcos',
    obras: ['OP-2026-001'] },
  { correo: 'subdirector@cotea.com.mx', nombre: 'Raúl Beltrán',
    rol: 'subdirector', tipo: 'dependencia', orgId: 'coatzacoalcos' },
  { correo: 'jefesup@cotea.com.mx', nombre: 'Ana Lagunes',
    rol: 'jefe_supervision', tipo: 'dependencia', orgId: 'coatzacoalcos' },
  // La última es el rol de FUERA, y existe por lo que NO se podía mirar. Ni
  // `cliente` ni `contratista` tenían cuenta sembrada, y son los dos únicos
  // roles cuyo menú no lleva Dashboard: su primera pestaña es Avance y la
  // segunda Fotos. Por eso el #3 vivió meses sin que nadie lo viera —la carga
  // diferida del historial sólo se disparaba en Dashboard y en Operación, así
  // que la galería del cliente enseñaba el riel sobre un historial que nadie
  // había pedido y el encabezado publicaba «0 semanas cerradas» de una obra que
  // sí tenía cierres—. Con las nueve cuentas anteriores ese defecto no se puede
  // reproducir en el preview: todas entran por Dashboard, que ya pedía el dato.
  //
  // Va del lado dependencia y con UNA obra asignada: `contratista` tiene
  // `todas_obras:false`, así que con cero asignadas no llega a ninguna obra y
  // la pestaña de Fotos no se puede abrir.
  { correo: 'contratista@cotea.com.mx', nombre: 'Constructora del Golfo',
    rol: 'contratista', tipo: 'dependencia', orgId: 'coatzacoalcos',
    obras: ['OP-2026-001'] },
];

const idDeCorreo = c => c.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

// ── Auth del emulador, por REST ─────────────────────────────────────────────
const authURL = ruta => `http://${HOST}:${PUERTO_AUTH}/identitytoolkit.googleapis.com/v1/${ruta}`;

// El proyecto del emulador de Auth, LEÍDO DEL TOKEN que él mismo firma.
//
// No se puede dar por sabido. El alta y el login entran por la ruta de la llave
// (`?key=…`), que no nombra proyecto: caen en el que el emulador tenga, que es
// el de `--project` con el que lo arrancaron. Poner claims, en cambio, es ruta
// de administrador y SÍ nombra proyecto. Si el nombre escrito aquí no es el del
// emulador, el alta funciona, el login funciona, y los claims se van a un
// proyecto vacío con USER_NOT_FOUND — que fue justo lo que pasó. Y un usuario
// sin claims entra a la aplicación y no es de ninguna organización: las reglas
// le niegan todo y la demo se ve como un producto roto.
//
// El `aud` del token es el proyecto que lo firmó, por construcción. No hay
// forma de que discrepe del que atendió el alta.
const proyectoDeToken = idToken => {
  const carga = idToken.split('.')[1];
  return JSON.parse(Buffer.from(carga, 'base64url').toString()).aud;
};
let proyectoAuth = null;

async function crearCuenta(correo) {
  const r = await fetch(authURL(`accounts:signUp?key=${LLAVE}`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: CLAVE, returnSecureToken: true }),
  });
  const j = await r.json();
  if (j.error && /EMAIL_EXISTS/.test(j.error.message)) {
    const r2 = await fetch(authURL(`accounts:signInWithPassword?key=${LLAVE}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: CLAVE, returnSecureToken: true }),
    });
    const j2 = await r2.json();
    if (!j2.localId) throw new Error(`no se pudo reusar ${correo}: ${JSON.stringify(j2.error)}`);
    proyectoAuth = proyectoDeToken(j2.idToken);
    return j2.localId;
  }
  if (!j.localId) throw new Error(`no se pudo crear ${correo}: ${JSON.stringify(j.error)}`);
  proyectoAuth = proyectoDeToken(j.idToken);
  return j.localId;
}

// Los claims son el dato con el que las reglas juzgan la petición Y con el que
// la interfaz decide el tipo (P5). Si se sembraran sólo en el perfil, el front
// entraría y elegiría mal la ruta: es justo el modo de fallo del #31 y el #35.
async function ponerClaims(localId, claims) {
  // Al proyecto que firmó el token del alta, no al que diga una constante.
  const r = await fetch(`http://${HOST}:${PUERTO_AUTH}/identitytoolkit.googleapis.com/v1/projects/${proyectoAuth || PROYECTO}/accounts:update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId, customAttributes: JSON.stringify(claims) }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error(`claims de ${localId}: ${JSON.stringify(j.error)}`);
}

// ── Firestore del emulador, por REST y como dueño ───────────────────────────
// `Bearer owner` salta las reglas. Es deliberado y sólo vale aquí: sembrar es
// justo lo que un administrador hace fuera de la app.
const fsURL = ruta =>
  `http://${HOST}:${PUERTO_FS}/v1/projects/${PROYECTO}/databases/(default)/documents/${ruta}`;

const aValor = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aValor(x)])) } };
  return { stringValue: String(v) };
};

async function escribir(ruta, datos) {
  const r = await fetch(fsURL(ruta), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, aValor(v)])) }),
  });
  if (!r.ok) throw new Error(`escribir ${ruta}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function borrar(ruta) {
  const r = await fetch(fsURL(ruta), {
    method: 'DELETE', headers: { Authorization: 'Bearer owner' },
  });
  if (!r.ok && r.status !== 404) throw new Error(`borrar ${ruta}: ${r.status}`);
}

// ── EL SEMBRADOR SE HACE CARGO DE LA EVIDENCIA MIGRADA ─────────────────────
//
// El sembrador escribe las fotos en el MAPA VIEJO (`avance/subs.fotos`). No
// escribe la subcolección `evidencia` ni levanta la bandera: eso lo hace la
// migración. El problema es que no las BORRABA, y la subcolección sobrevive a
// un resembrado.
//
// Eso dejó el preview mintiendo el 2026-10-08. Una corrida anterior había
// migrado las obras de dependencia cuando las partidas todavía no tenían `id`,
// así que la subcolección quedó con `partidaId` = `1, 2, 3, 6, 9, 10` y la
// bandera arriba. Al resembrar, las partidas pasaron a `1__0, 2__1, …` y la
// bandera siguió arriba apuntando a documentos viejos: la galería por semana
// enseñaba sus 13 fotos —no mira la partida— y la pantalla de captura decía
// «Agregar foto» en las doce. Trece fotos a la vista y ninguna alcanzable.
//
// Así que cada obra se siembra en UN solo estado, el sin migrar, que es el que
// este guion sabe escribir entero. Si se quiere ver el estado migrado se corre
// la migración encima, que deriva `partidaId` de los ids de verdad y verifica
// contra lo que la pantalla veía. Lo que no puede volver a pasar es la mezcla.
async function limpiarEvidenciaMigrada(prefijo, id) {
  await borrar(`${prefijo}obras/${id}/config/evidencia`);
  const r = await fetch(fsURL(`${prefijo}obras/${id}/evidencia?pageSize=300`),
    { headers: { Authorization: 'Bearer owner' } });
  if (!r.ok) return 0;
  const docs = (await r.json()).documents || [];
  for (const d of docs) await borrar(`${prefijo}obras/${id}/evidencia/${d.name.split('/').pop()}`);
  return docs.length;
}

// ── La obra de mentira ──────────────────────────────────────────────────────
// Las partidas se generan con una semilla fija: dos corridas dan lo mismo, así
// que una captura de pantalla de hoy se puede comparar con la de mañana. Un
// sembrador con `Math.random()` hace que cualquier diferencia entre dos
// pantallas sea indistinguible del azar.
const azarDe = semilla => () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;

function partidas(semilla, n, contratado) {
  const az = azarDe(semilla);
  const SECCIONES = ['PRELIMINARES', 'TERRACERÍAS', 'PAVIMENTOS', 'DRENAJE', 'SEÑALAMIENTO'];
  const filas = [];
  const pesos = Array.from({ length: n }, () => 0.4 + az());
  const suma = pesos.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    const imp = Math.round((contratado * pesos[i]) / suma);
    const cant = Math.round(50 + az() * 900);
    const a = Math.round(az() * 100);
    filas.push({
      // `id` SE SIEMBRA, no se deja que la app lo invente.
      //
      // Es `${sec}__${idx}`, copia literal de la auto-migración de
      // `avance/subs` en App.jsx (~22310). Antes la siembra no lo escribía y la
      // app se lo asignaba al abrir la obra —y lo GUARDABA—, así que durante
      // unos milisegundos la obra existía con un id distinto del que iba a
      // tener. Eso bastó para arruinar el recorrido del 2026-10-08: la
      // migración de evidencia corrió sobre los subs sin `id`, escribió
      // `partidaId: '1'`, la app renombró la partida a `1__0`, y la pantalla
      // de captura terminó diciendo «Agregar foto» en las doce partidas
      // mientras la galería por semana enseñaba las 13 fotos. La evidencia
      // estaba toda ahí y ninguna partida la alcanzaba.
      //
      // Sembrarlo deja el preview en el estado que tiene una obra de
      // producción ya abierta, que es el único sobre el que se puede medir.
      id: `${i + 1}__${i}`,
      sec: `${i + 1}`,
      cat: SECCIONES[i % SECCIONES.length],
      sub: `${SECCIONES[i % SECCIONES.length]} — concepto ${i + 1}`,
      unidad: ['M3', 'M2', 'ML', 'PZA', 'TON'][i % 5],
      cant, pu: Math.round(imp / cant), imp,
      a, cantEjec: Math.round((cant * a) / 100),
    });
  }
  return filas;
}

// ── Las fotos de evidencia ──────────────────────────────────────────────────
// Sin esto la pestaña de evidencia sale en blanco, y en blanco no se puede
// demostrar nada: la pantalla nueva consulta la evidencia POR SEMANA y POR
// PARTIDA, así que la semilla tiene que tener varias semanas y partidas que
// repitan en más de una. Con una sola semana, el selector sale con un solo
// chip y el eje de la partida no se distingue del de la semana.
//
// Cada foto es un SVG embebido —el sembrador no depende de ningún archivo
// suelto, igual que el logo del municipio— y lleva escrito encima la partida
// y la fecha en que se subió. Eso es lo que hace comprobable el cambio de
// semana: al cambiar de chip, la imagen dice otra fecha. Si dijera lo mismo
// en todas, un selector roto se vería idéntico a uno que funciona.
//
// `fecha` es la fecha de SUBIDA, que es lo que la app guarda y lo único que la
// pantalla afirma. Las fotos se reparten hacia atrás desde hoy, de semana en
// semana, para que el chip de la más reciente no salga vacío.
const COLORES = ['#3E5C76', '#5C7A5E', '#8A6E3E', '#6E4F6B', '#3E6C76', '#76503E'];

const fotoSVG = (texto, fecha, color) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">
       <rect width="160" height="120" fill="${color}"/>
       <rect x="0" y="92" width="160" height="28" fill="rgba(0,0,0,0.35)"/>
       <text x="80" y="50" font-family="Helvetica,Arial" font-size="11" font-weight="700"
             text-anchor="middle" fill="#fff">${texto}</text>
       <text x="80" y="66" font-family="Helvetica,Arial" font-size="8"
             text-anchor="middle" fill="rgba(255,255,255,0.75)">evidencia de muestra</text>
       <text x="80" y="110" font-family="Helvetica,Arial" font-size="9"
             text-anchor="middle" fill="#fff">subida ${fecha}</text>
     </svg>`);

// La fecha local de hace `k` semanas y `d` días, con el formato que guarda la
// app. Local y no UTC a propósito: ver `hoyLocalISO` en App.jsx.
const fechaAtras = (semanas, dias = 0) => {
  const f = new Date();
  f.setDate(f.getDate() - semanas * 7 - dias);
  return `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}-${String(f.getDate()).padStart(2,'0')}`;
};

// La semana de una foto, con el MISMO convenio que `semanaDeFoto` en App.jsx
// (ISO 8601, en local). Está aquí sólo para que el sembrador pueda decir
// cuántas semanas distintas sembró en vez de prometerlo: un sembrador que
// anuncia cinco semanas y escribe una deja la demo en blanco y la culpa
// parece del producto.
const claveSemana = (foto) => {
  const txt = typeof foto === 'string' ? '' : (foto.fecha || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt);
  if (!m) return 'sin fecha';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const sem = Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `S${String(sem).padStart(2, '0')}-${d.getFullYear()}`;
};

// Reparte fotos sobre las partidas de una obra.
//
//   · `semanas`  cuántas semanas hacia atrás llegan las cargas.
//   · `sinFecha` si mete además una foto sin `fecha` y una guardada como
//     cadena suelta. Son las dos formas que el esquema MIXTO de producción
//     tiene de no poder fechar una foto, y la pantalla las enseña en su
//     propio grupo. Se siembran en una sola obra para poder ver esa conducta
//     sin que domine la demo.
function fotosDe(filas, semilla, { semanas = 4, sinFecha = false } = {}) {
  const az = azarDe(semilla + 977);
  const mapa = {};
  const mete = (fila, foto) => {
    const k = fila.sec;
    (mapa[k] = mapa[k] || []).push(foto);
  };
  let n = 0;
  for (let k = 0; k < semanas; k++) {
    // Cada semana se fotografía OTRA cosa, con unas pocas partidas que
    // repiten: es lo que hace un residente de verdad, y es la razón de que el
    // eje de la consulta sea la partida y no el par de semanas.
    const cuantas = 2 + Math.floor(az() * 3);
    for (let i = 0; i < cuantas; i++) {
      // Las primeras dos partidas repiten semana a semana —son las que dan
      // material al eje «una partida a lo largo de sus semanas»—; el resto
      // van rotando.
      const idx = i < 2 ? i : (2 + Math.floor(az() * Math.max(filas.length - 2, 1))) % filas.length;
      const fila = filas[idx];
      const fecha = fechaAtras(k, Math.floor(az() * 5));
      mete(fila, { id: `fx${semilla}-${++n}`, fecha,
        url: fotoSVG(`${fila.cat} ${fila.sec}`, fecha, COLORES[(idx + k) % COLORES.length]) });
    }
  }
  if (sinFecha) {
    mete(filas[0], { id: `fx${semilla}-sf`,
      url: fotoSVG(`${filas[0].cat} ${filas[0].sec}`, 'sin fecha', '#4A5560') });
    mete(filas[1], fotoSVG(`${filas[1].cat} ${filas[1].sec}`, 'sin fecha', '#4A5560'));
  }
  return mapa;
}

// La forma del snapshot NO se inventa aquí: es la que escribe
// `crearSnapshotAvance` en App.jsx, campo por campo. En la primera versión de
// este guion la fecha se llamaba `fecha` y el resultado fue que las tres obras
// salían "Sin captura registrada" con el historial lleno — la app lee
// `fechaCaptura`. Un sembrador con el esquema casi-bien es peor que no tener
// sembrador: la pantalla miente y la mentira parece un defecto del producto.
// La clave de una semana, CON el relleno a dos dígitos. Es copia literal de
// `snapshotId` en App.jsx, y el relleno no es cosmético: la app agrupa por
// `S05-2026` y este guion escribía `S5-2026`. Mientras se siembra en octubre
// las dos coinciden por casualidad; en enero, la nota de la semana 3 quedaría
// guardada bajo una clave que ninguna pantalla busca.
const claveSnap = (semana, año) => `S${String(semana).padStart(2, '0')}-${año}`;

// `curva` es opcional y por omisión el historial crece en línea recta. Una
// recta sirve para casi todo, pero hay una cosa que NO se puede ver con ella:
// el renglón que compara el ritmo de los últimos cierres contra el del
// expediente completo. Sobre una recta los dos ritmos son el mismo número y la
// pantalla se calla —correctamente—, así que sin una obra doblada el renglón no
// se puede revisar en el preview, sólo en una prueba. La curva se pasa como
// fracciones del avance de hoy, una por semana cerrada y en orden.
const semanasDe = (filas, contratado, cuantas, curva = null) => {
  const hoy = new Date();
  const out = [];
  for (let k = cuantas; k >= 1; k--) {
    const f = new Date(hoy.getTime() - k * 7 * 86400000);
    const i = cuantas - k;
    const factor = curva ? curva[i] : (i + 1) / cuantas;
    const subs = filas.map(s => ({ sec: s.sec, a: Math.round(s.a * factor),
      imp: s.imp, cant: s.cant, pu: s.pu, cantEjec: Math.round(s.cantEjec * factor) }));
    const semana = Math.ceil(((f - new Date(f.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
    const ejecutado = subs.reduce((t, s) => t + (s.cantEjec * s.pu), 0);
    out.push({ id: claveSnap(semana, f.getFullYear()), semana, año: f.getFullYear(),
      tipo: 'oficial',
      fechaCaptura: f.toISOString(), fechaCierre: f.toISOString(),
      capturadoPor: 'siembra@local',
      subs,
      avancePonderado: subs.reduce((t, s) => t + (s.a * s.imp) / 100, 0) / contratado * 100,
      montoEjecutado: ejecutado, montoCatalogo: ejecutado, montoExcedente: 0,
      contratoRef: contratado, modoAvance: 'volumen', esquema: 3 });
  }
  return out;
};

// ── LAS ESTIMACIONES ───────────────────────────────────────────────────────
// Una estimación, con los nombres de campo que la APLICACIÓN lee.
//
// La siembra escribía `{num, fecha, estatus:'pagada'}` y las pantallas leen
// `{no, periodo, fechaFact, estatus:'Pagada'}`. Los tres desajustes se ven
// distinto y los tres son malos:
//   · `num` en vez de `no` deja todas las estimaciones sin número. React las
//     monta todas con la misma clave y avisa en consola, pero lo que ve el
//     cliente es una relación donde nada se llama nada.
//   · sin `periodo` la columna del periodo sale vacía en toda la tabla.
//   · «pagada» en minúscula es el peor. El corte semanal compara sin acentos y
//     en minúsculas, así que ESE sí la cuenta; pero la pantalla compara contra
//     la cadena exacta «Pagada», así que los KPIs de «Pagado bruto», «Cobrado
//     efectivo» y «Por cobrar» salen en cero con las estimaciones a la vista
//     justo debajo. Dinero sembrado que la pantalla no suma: en una demo eso
//     no se lee como un guion mal escrito, se lee como que el sistema no
//     cuadra.
const MAYUS1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const estimacionComoLaApp = (e, i) => {
  // La fecha de la siembra es la de FACTURACIÓN. El periodo son las cuatro
  // semanas que cierran en ella, y la recepción en ventanilla cae tres días
  // después del cierre: ese retraso es lo que la pantalla de la dependencia
  // mide —«Días en presentarla»— y con las fechas vacías la columna sale
  // diciendo «sin fecha de cierre» en todos los renglones. Un hueco sembrado
  // en una demo no se lee como un hueco: se reporta como defecto del producto.
  //
  // El periodo y la factura son DOS fechas, y antes eran una sola. Una
  // estimación **en proceso** tiene su periodo cerrado y todavía no tiene
  // factura, y con una sola fecha la siembra no podía expresarla: o la daba por
  // facturada —y entonces entra a FACTURADO 2026, que es otra cifra— o dejaba
  // el periodo vacío, que es el hueco que este mismo comentario prohíbe. Sin
  // una estimación en proceso sembrada, el «Por cobrar» de la pantalla y la
  // tarjeta de cobranza no se pueden mirar en el preview (#131).
  const fact = e.fecha || '';
  const fin = e.cierre || fact;
  const ini = fin ? desplazar(fin, -27) : '';
  return {
    no: e.num ?? e.no ?? i + 1,
    monto: e.monto,
    // «pagada» → «Pagada», la cadena contra la que comparan las pantallas.
    estatus: MAYUS1(String(e.estatus || 'En proceso')),
    fechaFact: fact,
    // Las dos pantallas leen el periodo distinto y las dos tienen que verlo:
    // la constructora la cadena `periodo`, la dependencia las dos fechas, que
    // son el dato duro del que ella saca los días. Se escriben las tres de la
    // misma fuente para que no puedan discrepar.
    periodo: fin ? periodoDeCierre(fin) : '',
    periodoIni: ini,
    periodoFin: fin,
    fechaRecepcion: fact ? desplazar(fact, 3) : '',
    recibidaPor: fact ? 'ventanilla@coatzacoalcos.gob.mx' : '',
    // LAS DOS FECHAS DEL PLAZO DE LEY, y las dos pueden venir vacías a
    // propósito. De la autorización arrancan los 20 días naturales del art. 63
    // y con la del pago se cierra la cuenta; sin ellas la pantalla no mide y lo
    // dice. Las vacías NO son un descuido de la siembra: es el estado de las
    // siete obras de producción hoy, y es el renglón gris que hay que poder
    // mirar al lado de los medidos para saber si se distingue de un «en plazo».
    fechaAutorizacion: e.autorizada || '',
    fechaPago: e.pagada || '',
    adjuntos: [],
  };
};

// Hoy en el calendario de la máquina, para las fechas que tienen que seguir
// significando lo mismo cada vez que se siembra. Las del plazo de ley son de
// ésas: una fecha de autorización tecleada en duro vale «vencida por 40 días»
// hoy y «vencida por 400» el año que viene, y el renglón azul —el que está
// DENTRO del plazo, que es el que hay que poder distinguir del vencido— se
// vuelve rojo solo y deja de poderse mirar en el preview.
const hoyISO = () => {
  const f = new Date();
  return `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}-${String(f.getDate()).padStart(2,'0')}`;
};
const haceDias = (dias) => desplazar(hoyISO(), -dias);

const desplazar = (iso, dias) => {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d + dias);
  return `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}-${String(f.getDate()).padStart(2,'0')}`;
};

// «02 ago – 15 sep 2026»: las cuatro semanas que cierran en la fecha dada.
const MES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const periodoDeCierre = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  const fin = new Date(a, m - 1, d);
  const ini = new Date(a, m - 1, d - 27);
  const dia = f => `${String(f.getDate()).padStart(2,'0')} ${MES_CORTO[f.getMonth()]}`;
  return `${dia(ini)} – ${dia(fin)} ${fin.getFullYear()}`;
};

// ── LAS NOTAS DEL CIERRE SEMANAL ───────────────────────────────────────────
// Texto de ejemplo, para que la pestaña de notas y el riel de la evidencia se
// vean con algo adentro en vez de con el hueco de siempre.
//
// NO DICEN NI UNA CIFRA, y es a propósito. Una nota sembrada que afirmara «se
// colaron 340 m³» contradiría al catálogo que siembra este mismo guion, y la
// demo acabaría enseñando una contradicción que el producto no tiene. Lo que
// una nota aporta de verdad es la causa —lluvia, un poste de CFE, un rechazo de
// laboratorio—, que es justo lo que la gráfica no puede decir.
const NOTAS_EJEMPLO = [
  'Lluvia los dos primeros días. Se recuperó el frente de terracerías el jueves y el viernes trabajando turno corrido.',
  'Entró el tramo de guarniciones. La cuadrilla de albañilería subió a doce; el residente pidió una más para la semana que entra.',
  'Se detuvo el colado del muro de contención: el laboratorio rechazó la primera remesa de concreto y se repuso al día siguiente.',
  'Visita de la supervisión externa el miércoles. Observación sobre el acero de distribución del cabezal; se corrigió en sitio.',
  'Semana completa sin interferencias. Se liberó el frente de pavimentación y queda listo para base hidráulica.',
  'La CFE no había retirado el poste del cadenamiento 0+180, así que ese frente no se tocó. Oficio enviado el lunes.',
  'Se abrió el segundo frente por el lado norte para no depender de la liberación del derecho de vía.',
  'Pruebas de compactación conformes en los tres cadenamientos muestreados. Los reportes se anexaron al expediente.',
];

// Una nota por semana, PERO DEJANDO HUECOS. La semana sin nota y la semana
// declarada «sin novedad» son dos estados distintos que la pantalla sabe
// separar; si la semilla las tapa todas, nadie ve que las separa — y el hueco
// es justo el caso que hay que poder reconocer en una demo.
//
// `escritaEn` es la fecha del CIERRE, no la de hoy. Fechadas hoy, las cinco
// semanas saldrían «editada hoy» y la pantalla estaría afirmando algo falso
// sobre cuándo se escribió cada una.
const notasDe = (semanas, semilla, autorNombre, rol) => {
  const notas = {};
  semanas.forEach((s, i) => {
    const turno = (semilla + i) % 5;
    if (turno === 3) return;                       // esta semana se quedó sin nota
    const texto = turno === 4 ? '' : NOTAS_EJEMPLO[(semilla * 3 + i) % NOTAS_EJEMPLO.length];
    // Por `claveSnap`, no por `s.id`: son el mismo valor hoy, pero la clave que
    // la app busca es ésta y es la que tiene que mandar.
    notas[claveSnap(s.semana, s.año)] = {
      texto,
      sinNovedad: texto === '',
      autor: 'siembra@local', autorNombre, rol,
      escritaEn: s.fechaCierre, editadaEn: s.fechaCierre,
    };
  });
  return notas;
};

async function sembrarObra(prefijo, id, obra, opciones = {}) {
  // Primero se tira la evidencia migrada de corridas anteriores: si no, la
  // bandera sobrevive al resembrado y la obra queda con la galería leyendo
  // documentos viejos y la captura sin encontrar ninguno. Ver
  // `limpiarEvidenciaMigrada`.
  const tiradas = await limpiarEvidenciaMigrada(prefijo, id);
  const filas = partidas(obra.semilla, obra.nPartidas, obra.contratado);
  // Las fotos cuelgan de la partida bajo la llave de su `subId`, que ahora es
  // el `id` sembrado. Es la misma forma mixta `{ llave: [foto, …] }` que tiene
  // producción, y es la que leen tanto la captura como la pestaña de evidencia.
  // La llave da igual para leer —`evidenciaDeObra` aplana con `.flat()`— pero
  // no para escribir: la app agrega la foto nueva bajo `s.id`, y si la siembra
  // usa otra llave la partida acaba con dos cubetas de fotos en el mismo
  // documento. Se siembra con la llave que la app va a usar.
  let nFotos = 0, semanasConFoto = new Set();
  if (obra.fotosSemanas) {
    const mapa = fotosDe(filas, obra.semilla,
      { semanas: obra.fotosSemanas, sinFecha: !!obra.fotosSinFecha });
    for (const f of filas) if (mapa[f.sec]) f.fotos = { [f.id]: mapa[f.sec] };
    for (const lista of Object.values(mapa)) for (const foto of lista) {
      nFotos++;
      semanasConFoto.add(claveSemana(foto));
    }
  }
  await escribir(`${prefijo}obras/${id}`, {
    nombre: obra.nombre, contrato: obra.contrato, presupuesto: obra.contratado,
    estado: 'activa', cliente: obra.cliente, ubicacion: obra.ubicacion,
    inicio: obra.inicio, fin: obra.fin, modoAvance: 'volumen',
    ...(opciones.gpId ? { gpId: opciones.gpId } : {}),
  });
  await escribir(`${prefijo}obras/${id}/config/info`, {
    nombre: obra.nombre, contrato: obra.contrato, presupuesto: obra.contratado,
    cliente: obra.cliente, ubicacion: obra.ubicacion, modoAvance: 'volumen',
    inicio: obra.inicio, fin: obra.fin, diasPago: 30,
    // Texto libre hasta que exista el padrón (#41). Se siembra sólo donde se
    // pasa, para que quede a la vista también el caso de la obra sin empresa
    // capturada, que es el que la tabla tiene que saber decir.
    ...(obra.empresa ? { empresaEjecutante: obra.empresa, empresaRFC: obra.rfc } : {}),
    ...(opciones.gpId ? { gpId: opciones.gpId } : {}),
  });
  await escribir(`${prefijo}obras/${id}/avance/subs`, {
    data: filas, fecha: new Date(Date.now() - (obra.diasSinCaptura ?? 2) * 86400000).toISOString(),
    por: 'siembra@local',
  });
  const semanas = semanasDe(filas, obra.contratado, obra.semanas ?? 3, obra.curva);
  await escribir(`${prefijo}obras/${id}/avance/historial`, { semanas });
  // Las notas cuelgan de `avance/notas`, con la MISMA clave que el snapshot
  // (`S38-2026`). Si la clave no coincide, la nota existe en Firestore y la
  // pantalla sigue diciendo «sin nota» — y eso se lee como defecto del producto.
  await escribir(`${prefijo}obras/${id}/avance/notas`, {
    notas: notasDe(semanas, obra.semilla,
      opciones.conEconomia ? 'Residente de obra' : 'Supervisor de obra',
      opciones.conEconomia ? 'residente' : 'supervisor_obra'),
  });
  await escribir(`${prefijo}obras/${id}/config/estimaciones`, {
    data: (obra.estimaciones || []).map(estimacionComoLaApp),
  });

  // El programa de obra (#51, el avance contra una recta). Se siembra SÓLO
  // donde se pasa, y eso es el punto: con una obra que lo tiene y otra que no,
  // el preview enseña los dos casos lado a lado. Hasta el 2026-11-06 lo que se
  // comparaba eran dos rótulos —«Avance programado» contra «Avance lineal»—
  // porque la obra sin anexo igual dibujaba su recta; desde el #110 la obra sin
  // anexo no dibuja NADA y en su lugar dice qué archivo falta. Lo que hay que
  // mirar cambió con eso: no si se entiende la diferencia entre dos rótulos,
  // sino si un panel con tres curvas en vez de cuatro se lee como una ausencia
  // declarada y no como una gráfica a medio cargar.
  //
  // La forma del documento es la que escribe `confirmar()` en
  // `CargaDelPrograma`, no una inventada: si no empatara, el preview diría que
  // la pantalla no lee el programa cuando lo que no empata es la semilla.
  if (obra.programa) {
    const pr = obra.programa;
    await escribir(`${prefijo}obras/${id}/config/programa`, {
      obraId: id,
      esquema: 1,
      inicio: pr.inicio,
      fin: pr.fin,
      duracion: null,
      obraDelArchivo: pr.obraDelArchivo || obra.contrato,
      meses: pr.montos.length,
      total: pr.montos.reduce((t, m) => t + m, 0),
      totalDeclarado: pr.montos.reduce((t, m) => t + m, 0),
      partidas: [{
        sec: '1000 00', sub: 'PROGRAMA GENERAL',
        importe: pr.montos.reduce((t, m) => t + m, 0),
        montos: pr.montos,
        barra: 'Barra=' + pr.montos.map(() => '0-100').join(','),
      }],
      avisos: [],
      filaEncabezado: 18,
      // El rótulo sigue al formato del anexo. Estaba fijo en «AE11» y la obra
      // de dependencia, cuyo anexo es un DE-5, se presentaba en pantalla como
      // AE11: la demo contaba algo que no era. `(sembrado)` se queda, para que
      // nadie confunda este archivo con uno de verdad.
      archivo: `${pr.formato || 'AE11'} PROGRAMA GENERAL MONTOS (sembrado).xlsx`,
      fechaCarga: new Date().toISOString().slice(0, 10),
    });
  }

  // Sólo del lado constructora: es exactamente lo que una dependencia no pide.
  if (opciones.conEconomia) {
    await escribir(`${prefijo}obras/${id}/avance/maquinaria`, {
      data: [
        { fecha: '2026-09-01', equipo: 'Retroexcavadora CAT 420', horas: 120, imp: 186000 },
        { fecha: '2026-09-08', equipo: 'Vibrocompactador',        horas: 64,  imp: 92000 },
      ],
    });
    await escribir(`${prefijo}obras/${id}/avance/materiales`, {
      data: [{ fecha: '2026-09-03', material: 'Cemento CPC 30R', cant: 400, imp: 1040000 }],
    });
    await escribir(`${prefijo}obras/${id}/config/otros_gastos`, {
      items: [{ fecha: '2026-09-10', concepto: 'Fianza de cumplimiento', importe: 240000 }],
    });
    await escribir(`${prefijo}obras/${id}/subcontratos/lista`, {
      data: [{ nombre: 'TERRACERÍAS DEL SURESTE SA', monto: 3400000, pagado: 2100000, concepto: 'Terracerías' }],
    });
    // LA FORMA ES LA DE PRODUCCIÓN, NO UNA PARECIDA. Esta semana se sembraba
    // con `semana: 38` y `nPersonas: 34`, y ninguno de los dos campos es el que
    // lee la app: el importador escribe `semana: 'Semana 38'` y cuenta la gente
    // en `totalDir`/`totalInd` por tipo de trabajador. El KPI de personal del
    // tablero salía «0D · 0I · 38» —cero personas donde la siembra quería 34, y
    // un «38» que no se lee como semana— y el preview, que es donde se verifica
    // antes de mezclar, enseñaba un defecto que producción no tiene.
    // Y LA PROCEDENCIA DEL DESGLOSE D/I, que es lo que decide si sale a
    // pantalla. Desde el 2026-11-19 el importador anota en cada carga de
    // cuántas filas lo dijo la columna «Tipo (D/I)» del Excel y de cuántas lo
    // dedujeron doce palabras del puesto, y el desglose sólo se publica cuando
    // consta que lo dijo la columna. Se siembran LOS TRES ESTADOS, porque los
    // tres existen en producción y los tres se ven distinto:
    //
    //   S36  sin los dos conteos        → carga vieja: «no consta». Así están
    //                                     las 67 semanas que ya había el
    //                                     2026-11-19.
    //   S37  con filas adivinadas       → el archivo no traía la columna
    //                                     completa. Tampoco se publica.
    //   S38  todas de columna           → es dato: se publica «26D · 8I».
    //
    // La 0121 se queda SIN declarar a propósito: así el KPI del portafolio
    // tiene una obra que entra al total y no al desglose, que es el caso donde
    // sumar su cero al desglose lo volvía una cifra de la mitad de la gente
    // presentada como la de todas.
    const declara = id !== '0121';
    await escribir(`${prefijo}obras/${id}/nomina/historial`, {
      semanas: [
        { id: 'S36-2026', semana: 'Semana 36', año: 2026, fecha: '7/9/2026',
          archivo: 'NOMINA-S36.xlsx', totalNomina: 455000,
          totalHEImp: 33000, totalHE: 33000,
          totalDir: 24, totalInd: 8, totalDias: 186 },
        { id: 'S37-2026', semana: 'Semana 37', año: 2026, fecha: '14/9/2026',
          archivo: 'NOMINA-S37.xlsx', totalNomina: 470000,
          totalHEImp: 37000, totalHE: 37000,
          totalDir: 25, totalInd: 8, totalDias: 192,
          ...(declara ? { tipoDeColumna: 29, tipoDePuesto: 4 } : {}) },
        { id: 'S38-2026', semana: 'Semana 38', año: 2026, fecha: '21/9/2026',
          archivo: 'NOMINA-S38.xlsx', totalNomina: 486000,
          totalHEImp: 41000, totalHE: 41000,
          totalDir: 26, totalInd: 8, totalDias: 198,
          ...(declara ? { tipoDeColumna: 34, tipoDePuesto: 0 } : {}) },
      ],
    });
  }

  // Lo que se sembró de verdad, no lo que se pidió sembrar.
  const conFoto = filas.filter(f => f.fotos).length;
  if (obra.fotosSemanas) console.log(
    `  ${id}: ${nFotos} foto(s) en ${conFoto} partida(s), ` +
    `${[...semanasConFoto].sort().reverse().join(' ')}` +
    // Se dice en voz alta: quien resiembra tiene que saber que la obra volvió
    // al estado sin migrar y que si quería el migrado hay que correr la
    // migración otra vez. Callarlo es cómo nació la mezcla.
    (tiradas ? `  [evidencia migrada anterior: ${tiradas} doc(s) tirados, obra sin migrar]` : ''));
}

(async () => {
  // El seguro. Si alguien corre esto sin emulador, `fetch` a 127.0.0.1 falla y
  // no pasa nada; el peligro sería que las variables apuntaran a otro lado.
  if (process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIRESTORE_EMULATOR_HOST.startsWith('127.0.0.1')) {
    console.error('FIRESTORE_EMULATOR_HOST no apunta a 127.0.0.1. Abortado.');
    process.exit(1);
  }
  try {
    const r = await fetch(`http://${HOST}:${PUERTO_FS}/`);
    if (!r.ok && r.status !== 404) throw new Error('respuesta rara');
  } catch {
    console.error(`No hay emulador de Firestore en ${HOST}:${PUERTO_FS}.`);
    console.error(`  firebase emulators:start --only firestore,auth --project ${PROYECTO}`);
    process.exit(1);
  }

  // ── Organizaciones ────────────────────────────────────────────────────────
  await escribir('orgs/fosmon', { nombre: 'FOSMON Construcciones', tipo: 'constructora', activa: true });
  await escribir('orgs/coatzacoalcos', {
    nombre: 'H. Ayuntamiento de Coatzacoalcos', tipo: 'dependencia', activa: true,
  });
  // La marca del cliente. Sólo la dependencia la tiene capturada, para poder
  // ver las dos conductas: con marca sale el logo y el nombre; sin marca, del
  // lado constructora, sigue saliendo la leyenda de siempre.
  await escribir('orgs/coatzacoalcos/config/branding', {
    empresa: 'H. Ayuntamiento de Coatzacoalcos',
    empresaCorta: 'Coatzacoalcos',
    dominio: 'cotea.com.mx',
    // EL CAMPO ES `logoBlanco`, que es el que la app GUARDA y el primero que
    // lee (`marca.logoBlanco || marca.logoNegro`). El sembrador escribía sólo
    // `logoNegro`, así que el preview caía siempre al respaldo y la ruta
    // normal —la que usa un cliente que subió su logo por Configuración →
    // Marca— no se veía nunca. Se siembran los dos, con el mismo dibujo: así
    // se recorre la de verdad sin perder el caso del respaldo.
    //
    // Y ES OSCURO sobre transparente, no blanco: `logoBlanco` quiere decir «el
    // del fondo blanco». Sembrarlo en blanco haría que el preview enseñara un
    // hueco donde el papel sí pinta, y daría por bueno un error de colocación.
    // UN PNG, QUE ES LO QUE LA APP GUARDA. `PantallaMarca` reduce el archivo
    // en un canvas y lo serializa a raster, así que en producción este campo
    // SIEMPRE trae un PNG o un JPEG. Se sembró primero como SVG y no servía
    // para nada: `jsPDF.addImage` no pinta SVG, así que el preview enseñaba la
    // portada sin logo y daba por bueno un camino que en producción sí pinta.
    // Un dato de prueba con otro formato que el real esconde el defecto.
    //
    // Y ES OSCURO sobre transparente: `logoBlanco` quiere decir «el del fondo
    // BLANCO», no «el logo en blanco». Sembrarlo en claro habría dado por
    // buena una colocación sobre el panel oscuro, donde no se vería.
    logoBlanco: 'data:image/png;base64,'
      + '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'
      + 'gg==',
    // SVG embebido: el sembrador no depende de ningún archivo suelto.
    logoNegro: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">
         <rect x="1" y="1" width="118" height="38" rx="6" fill="none" stroke="#1A1A1A" stroke-width="2"/>
         <text x="60" y="17" font-family="Helvetica,Arial" font-size="11" font-weight="700"
               text-anchor="middle" fill="#1A1A1A">COATZACOALCOS</text>
         <text x="60" y="30" font-family="Helvetica,Arial" font-size="8"
               text-anchor="middle" fill="#6B6B6B">OBRAS PÚBLICAS</text>
       </svg>`),
  });
  console.log('orgs sembradas: fosmon (constructora) · coatzacoalcos (dependencia)');

  // ── Cuentas, claims y perfiles ────────────────────────────────────────────
  for (const c of CUENTAS) {
    const uid = await crearCuenta(c.correo);
    // `todas` es «todas las obras de SU organización». Soporte no tiene
    // organización, así que ponérselo en true sería sembrarle una facultad que
    // no existe y que ninguna regla le concede.
    //
    // Una cuenta que trae `obras` es, por definición, una de obras parciales:
    // dejarle `todas: true` sembraría un usuario que las reglas dejan leer todo
    // y que la pantalla filtra, y entonces el preview estaría mintiendo sobre
    // cuál de los dos cerrojos es el que aguanta.
    const asignadas = c.obras || [];
    await ponerClaims(uid, {
      rol: c.rol, orgId: c.orgId, tipo: c.tipo,
      todas: c.orgId !== null && asignadas.length === 0, obras: asignadas,
    });
    await escribir(`usuarios/${idDeCorreo(c.correo)}`, {
      // EL CAMPO SE LLAMA `email`, NO `correo`. Medido en producción el
      // 2026-11-23: los 18 perfiles traen `email` y ninguno trae `correo`.
      // Sembrado con el nombre equivocado, la columna Email de la gestión de
      // usuarios salía VACÍA en el preview y —peor— la comparación que
      // protege la propia fila (`u.email !== usuario.correo`) daba verdadero
      // para todos, así que los botones de borrar y de cambiar correo se
      // ofrecían sobre uno mismo. Un defecto fabricado por el dato de prueba,
      // que en producción no existe.
      nombre: c.nombre, email: c.correo, rol: c.rol, activo: true,
      orgId: c.orgId, obras_asignadas: asignadas, bienvenidaVista: true, uid,
    });
    console.log(`  ${c.correo}  ${c.rol}  tipo=${c.tipo}  org=${c.orgId}` +
                (asignadas.length ? `  obras=${asignadas.join(',')}` : ''));
  }

  // ── Dos perfiles con el rol fuera de la lista de su organización ──────────
  //
  // No son cuentas: son PERFILES, sin identidad en Auth, y eso es a propósito.
  // El caso que vienen a dejar ver es de lectura, no de sesión: el desplegable
  // de rol de «Editar usuario» compara el rol GUARDADO contra la lista de la
  // organización, y `ROLES_CONSTRUCTORA` y `ROLES_DEPENDENCIA` no comparten ni
  // un identificador. Un usuario migrado entre tipos de organización, o uno sin
  // `rol`, pintaba el PRIMER rol de la lista —que es mando— y «Editar usuario»
  // manda `{rol: form.rol}` a `actualizarUsuario`: quien entraba a reasignarle
  // una obra le reescribía el permiso sin tocar el campo.
  //
  // Sembrarles una identidad habría sembrado un usuario que puede iniciar
  // sesión con un rol que su organización no reconoce, que es un escenario
  // distinto y peor. `listarUsuarios` devuelve Firestore combinado con el
  // estado de Auth, así que estos dos salen en la lista y se pueden abrir.
  const PERFILES_HUERFANOS = [
    { correo: 'migrado@fosmon.com.mx', nombre: 'Rol de la otra organización',
      rol: 'director_obras' },   // existe, pero sólo en una dependencia
    { correo: 'sinrol@fosmon.com.mx', nombre: 'Perfil sin rol', rol: '' },
  ];
  for (const p of PERFILES_HUERFANOS) {
    await escribir(`usuarios/${idDeCorreo(p.correo)}`, {
      nombre: p.nombre, email: p.correo, rol: p.rol, activo: true,
      orgId: 'fosmon', obras_asignadas: [], bienvenidaVista: true,
    });
    console.log(`  ${p.correo}  rol=${p.rol || '(vacío)'}  org=fosmon  (sin identidad en Auth)`);
  }

  // ── Obras de la constructora, en la RAÍZ ──────────────────────────────────
  const EST_C = [
    { num: 1, monto: 4200000, estatus: 'pagada',    fecha: '2026-07-15' },
    { num: 2, monto: 5100000, estatus: 'pagada',    fecha: '2026-08-15' },
    { num: 3, monto: 3900000, estatus: 'facturada', fecha: '2026-09-10' },
  ];
  await sembrarObra('', '0114', {
    nombre: 'Oaxaca Parque Lineal', contrato: 'LO-920-2026-0114', contratado: 38500000,
    cliente: 'Gobierno de Oaxaca', ubicacion: 'Oaxaca de Juárez, Oax.',
    inicio: '2026-03-01', fin: '2026-12-15', semilla: 11, nPartidas: 14,
    estimaciones: EST_C, semanas: 6, diasSinCaptura: 2, fotosSemanas: 5,
    // Seis cierres doblados, no una recta: esta obra ARRANCÓ fuerte y se frenó.
    // Las fracciones no se eligieron por estética, reproducen el cociente que
    // la 0114 de producción trae medido —0.61 entre el ritmo de los últimos
    // cuatro cierres y el de todo el expediente—, que es el único caso real
    // fuera de la banda de la pantalla. Con la recta de las demás obras los dos
    // ritmos coinciden y el renglón se calla, así que sin esta curva el aviso
    // no se puede mirar en el preview.
    curva: [0.80, 0.87, 0.927, 0.952, 0.976, 1.00],
    // Diez meses, marzo a diciembre, con arranque lento: 1% el primer mes y el
    // pico en el octavo. Es la forma de una curva S de verdad y suma los
    // $38.5M del contrato. La 0121 se queda SIN programa a propósito, para que
    // las dos pantallas se puedan comparar en la misma sesión.
    programa: {
      inicio: '2026-03-01', fin: '2026-12-15',
      montos: [385000, 770000, 1540000, 2695000, 3850000,
               5390000, 6545000, 6930000, 5775000, 4620000],
    },
  }, { conEconomia: true, gpId: '0114' });
  // EL CASO DEL #96, CON LAS CIFRAS DE VERDAD. Esta obra es el colector real
  // como estaba dado de alta: se capturó copiando el emisor (la 0131) y se
  // quedó con SU presupuesto —$27,489,778.08 en vez de $12,890,541.86— y con su
  // plazo —2026-08-29→2027-02-24 en vez de 2026-08-27→2026-12-24—. El programa
  // que se le siembra es el de su propio anexo, con las tres cifras buenas.
  //
  // Va del lado CONSTRUCTORA porque es una obra de constructora, y aparte de
  // la 0114 —que cuadra al peso— y de la 0121 —que no tiene programa— para que
  // una sola sesión enseñe los tres casos: el que grita, el que se calla y el
  // que no tiene con qué. El caso de la dependencia está en la OP-2026-002.
  //
  // Aquí decía que la pantalla del programa «sólo existe de este lado». Es
  // FALSO y lo escribí yo el 2026-11-04: di por hecho que no existía porque
  // en el preview abrí la pestaña «Contrato» de la dependencia y me quedé en
  // su primera sub-pestaña. La ruta es «Contrato → Catálogo de conceptos», y
  // ahí está. De esa conclusión apresurada salió un pendiente inventado —el
  // #98 original— y, al ir a comprobarlo, el defecto de verdad: la ruta de la
  // dependencia no tenía regla en Firestore (ver #98).
  //
  // Las cifras del anexo salen de pasarlo por el parser de la app
  // (`scripts/medir-programa-real-se-lee.cjs`), no de leerlas a ojo. Los montos
  // mensuales son la forma de ese programa —arranca fuerte y cierra flojo, que
  // es lo que lo separa 9.9 puntos de la recta— y suman el total al peso.
  await sembrarObra('', '0128', {
    nombre: 'SIOP Colector Malecón', contrato: 'SIOP-2026-0128',
    contratado: 27489778.08,
    cliente: 'SIOP Veracruz', ubicacion: 'Coatzacoalcos, Ver.',
    inicio: '2026-08-29', fin: '2027-02-24', semilla: 53, nPartidas: 9,
    // Una pagada y una EN PROCESO que es la mayor parte del dinero: es la forma
    // de la 0128 de producción, la obra donde la tarjeta de cobranza NO SE
    // PINTABA con $3.9M por cobrar porque el detector se había quedado con la
    // definición vieja (#131). Con las tres de `EST_C` —dos pagadas y una
    // facturada— el «por cobrar» se queda en el 30% y la tarjeta se calla con
    // razón, así que el defecto no se podía mirar en ninguna pantalla.
    estimaciones: [...EST_C.slice(0, 1),
      { num: 2, monto: 12000000, estatus: 'En proceso', cierre: '2026-10-25' }],
    semanas: 3, diasSinCaptura: 4, fotosSemanas: 2,
    programa: {
      inicio: '2026-08-27', fin: '2026-12-24',
      obraDelArchivo: 'AE11 PROGRAMA GENERAL MONTOS COLECTOR',
      montos: [1289054.19, 3867162.56, 3222635.47, 2578108.37, 1933581.27],
    },
  });
  await sembrarObra('', '0121', {
    nombre: 'SIOP Coatza Rehab. Av. Universidad', contrato: 'SIOP-2026-0121', contratado: 24800000,
    cliente: 'SIOP Veracruz', ubicacion: 'Coatzacoalcos, Ver.',
    inicio: '2026-05-01', fin: '2026-11-30', semilla: 29, nPartidas: 11,
    estimaciones: EST_C.slice(0, 2), semanas: 3, diasSinCaptura: 12, fotosSemanas: 3,
  }, { conEconomia: true, gpId: '0121' });

  // El Sheet de GP: es lo que alimenta el chip y el margen del lado
  // constructora. Sin esto el tablero de FOSMON saldría sin gasto y no se
  // podría comprobar que quedó igual.
  //
  // Cuáles semanas hay es del SHEET (`semanasDisponibles`), no de la obra. Una
  // obra sin gasto en una semana que el Sheet sí midió gastó CERO; eso no es un
  // hueco, y promediarla contra cero es la cuenta correcta. El hueco que sí
  // impide medir el ritmo es una columna que el Sheet no trae, y ése es global
  // a las dos obras, así que no se puede enseñar con una obra sí y otra no. Lo
  // fija el banco `prueba-la-semana-sin-su-año.cjs`; aquí se siembra la forma
  // de producción.
  //
  // LAS SEIS SEMANAS CRUZAN EL 31 DE DICIEMBRE, a propósito. Desde el #47
  // (2026-11-17) la clave lleva su año (`S2025-52`) y la serie es una ventana
  // de 53 semanas que no se corta en enero; el escenario que el preview tiene
  // que poder enseñar es justamente ése, porque era el único que salía mal y
  // que antes no se podía ni preguntar. **2025 tiene 52 semanas ISO**, así que
  // `S2025-51 → S2025-52` encadena y la velocidad de las últimas cuatro se
  // mide a caballo del año. Sembrarlo todo dentro de un año dejaría el
  // recorrido por el preview sin el caso que importa.
  //
  //   0114 — gasta las cuatro últimas: el ritmo sale de cuatro semanas
  //          reales, dos de 2025 y dos de 2026.
  //   0121 — se salta S2025-49, S2025-51 y S2025-52: mismo ritmo medible, con ceros dentro.
  //
  // La 0114 además trae un proveedor que aparece por primera vez en la última
  // semana y otro que sube más del 50%, para que la tarjeta de excepciones y
  // la tabla de abajo tengan en qué coincidir o discrepar.
  //
  // La pestaña de Gastos arma su obra como `{...resumen, ...detalle}`: el
  // resumen sale de `global/gp_construct` y el detalle de
  // `global/gp_detalle/obras/<id>`, y el detalle GANA. Sembrar sólo el resumen
  // dejaba el preview enseñando el detalle de un volcado de producción que
  // alguien importó al emulador y nadie vuelve a tocar: semanas, proveedores y
  // rubros ajenos encima de los sembrados. Por eso los dos salen de aquí.
  //
  // LOS RUBROS VAN CON LA ETIQUETA COMPLETA POR LLAVE, y la 0114 trae DOS que
  // comparten el número 300. Eso no es un adorno del dato de prueba: en
  // producción 14 de las 35 obras de GP tienen INDIRECTOS y SUBCONTRATOS
  // compartiendo el 300, y la consulta por obra los escribe así —
  // `rubros['300 INDIRECTOS']` y `rubros['300 SUBCONTRATOS']`, cada uno con su
  // `nombre` entero—. Un preview sembrado con un rubro por número no puede
  // enseñar el defecto que importa: si la lista agrupa por `r.id`, los dos
  // caen en la misma cubeta y el dinero de subcontratos se imprime dentro de
  // indirectos. Con esta forma el recorrido por el preview lo ve o no lo ve.
  //
  // Y el rubro trae SUS SEMANAS, porque el escritor de producción siempre se
  // las pone (`functions/index.js`: `semanas: {}, meses: {}, años: {}` al
  // crear el rubro). Sembrarlo sin ellas no era "un dato más pobre": la
  // pestaña de rubros lee `r.semanas[s]` sin red y tronaba la vista entera.
  // Un dato de prueba más delgado que el que escribe producción esconde el
  // defecto en lugar de enseñarlo.
  const gpSemanas = ['S2025-48','S2025-49','S2025-50','S2025-51','S2025-52','S2026-01'];
  const GP = {
    '0114': {
      id: '0114', nombre: 'Oaxaca Parque Lineal', grandTotal: 21400000,
      // Los cuatro `grandTotal` suman el de la obra (21,400,000). Si se mueve
      // uno hay que mover otro: un rubro que no cuadra con su obra haría que
      // el preview enseñara una discrepancia que el código no tiene.
      rubros: {
        '100 MATERIALES': { id: '100', nombre: '100 MATERIALES',
          nombreCorto: 'Materiales', grandTotal: 12300000,
          semanas: { 'S2025-50': 1060000, 'S2025-51': 1210000, 'S2025-52': 1000000, 'S2026-01': 1330000 } },
        '300 INDIRECTOS': { id: '300', nombre: '300 INDIRECTOS',
          nombreCorto: 'Indirectos', grandTotal: 1310000,
          semanas: { 'S2025-50': 115000, 'S2025-51': 130000, 'S2025-52': 105000, 'S2026-01': 140000 } },
        '300 SUBCONTRATOS': { id: '300', nombre: '300 SUBCONTRATOS',
          nombreCorto: 'Subcontratos', grandTotal: 2590000,
          semanas: { 'S2025-50': 225000, 'S2025-51': 250000, 'S2025-52': 215000, 'S2026-01': 280000 } },
        '400 MAQUINARIA Y EQUIPO': { id: '400', nombre: '400 MAQUINARIA Y EQUIPO',
          nombreCorto: 'Maquinaria y equipo', grandTotal: 5200000,
          semanas: { 'S2025-50': 450000, 'S2025-51': 510000, 'S2025-52': 420000, 'S2026-01': 560000 } },
      },
      proveedores: [
        { nombre: 'Aceros del Istmo', rubroId: '100', rubroNombre: 'Materiales',
          total: 6200000, grandTotal: 6200000,
          semanas: { 'S2025-50': 820000, 'S2025-51': 910000, 'S2025-52': 760000, 'S2026-01': 1180000 } },
        { nombre: 'Concretos Oaxaca', rubroId: '100', rubroNombre: 'Materiales',
          total: 4900000, grandTotal: 4900000,
          semanas: { 'S2025-50': 700000, 'S2025-51': 880000, 'S2025-52': 640000, 'S2026-01': 690000 } },
        // Nuevo de verdad: no aparece antes de S2026-01. La tarjeta de excepción y
        // la tabla de abajo tienen que coincidir en que es uno solo.
        { nombre: 'Rentas Tehuantepec', rubroId: '400', rubroNombre: 'Maquinaria y equipo',
          total: 440000, grandTotal: 440000, semanas: { 'S2026-01': 440000 } },
        // Los dos rubros que comparten el 300 traen proveedor propio: en
        // producción es el proveedor el que crea el rubro, así que un rubro
        // con dinero y sin proveedor no existe. Ambos empiezan en S2025-50 y suben
        // menos del 50% en S2026-01, para no inventar una excepción que la tarjeta
        // de arriba tendría que explicar.
        { nombre: 'Nómina Indirecta Oaxaca', rubroId: '300', rubroNombre: 'Indirectos',
          total: 1310000, grandTotal: 1310000,
          semanas: { 'S2025-50': 115000, 'S2025-51': 130000, 'S2025-52': 105000, 'S2026-01': 140000 } },
        { nombre: 'Terracerías del Sur', rubroId: '300', rubroNombre: 'Subcontratos',
          total: 2590000, grandTotal: 2590000,
          semanas: { 'S2025-50': 225000, 'S2025-51': 250000, 'S2025-52': 215000, 'S2026-01': 280000 } },
      ],
    },
    '0121': {
      id: '0121', nombre: 'SIOP Coatza Rehab. Av. Universidad', grandTotal: 19900000,
      rubros: {
        '100 MATERIALES': { id: '100', nombre: '100 MATERIALES',
          nombreCorto: 'Materiales', grandTotal: 19900000,
          semanas: { 'S2025-48': 1400000, 'S2025-50': 1950000, 'S2026-01': 1620000 } },
      },
      proveedores: [
        { nombre: 'Triturados del Golfo', rubroId: '100', rubroNombre: 'Materiales',
          total: 3100000, grandTotal: 3100000,
          semanas: { 'S2025-48': 900000, 'S2025-50': 1200000, 'S2026-01': 1000000 } },
        { nombre: 'Asfaltos Coatza', rubroId: '100', rubroNombre: 'Materiales',
          total: 1870000, grandTotal: 1870000,
          semanas: { 'S2025-48': 500000, 'S2025-50': 750000, 'S2026-01': 620000 } },
      ],
    },
  };
  // El documento se siembra con la forma que escribe la CONSULTA POR OBRA, que
  // es la que corre en producción desde el 2026-10-30. Ya no hay `colMap`
  // porque no hay columnas: el panel de diagnóstico tiene que enseñar lo otro
  // —qué se pidió, cuántos renglones vinieron y qué dinero no se pudo
  // clasificar—. El camino de la hoja quedó como respaldo que un administrador
  // elige, y su lista de columnas la cubre `prueba-parser-gp.cjs`.
  //
  // La semana de la OBRA se SUMA de sus rubros, no se teclea. Tecleada en los
  // dos lados, un día una se movía y la otra no, y el preview enseñaba un
  // tablero que se contradice con su propio desglose: una cuenta por número.
  //
  // Y el proveedor se CUELGA de su rubro por `rubroNombre`, que es como lo
  // escribe producción (`rubroNombre: rubro.nombreCorto`, y el mismo objeto
  // queda en las dos listas). Sin esto el rubro decía «0 proveedor(es)» al
  // lado de $12,300,000 — una forma que el escritor no puede producir.
  for (const o of Object.values(GP)) {
    o.semanas = {};
    for (const r of Object.values(o.rubros)) {
      r.proveedores = o.proveedores.filter((p) => p.rubroNombre === r.nombreCorto);
      for (const [s, v] of Object.entries(r.semanas)) {
        o.semanas[s] = (o.semanas[s] || 0) + v;
      }
    }
  }
  // `renglonesLeidos` se CUENTA de lo sembrado, no se teclea: un número que
  // contradijera a las semanas de abajo haría que el preview enseñara una
  // inconsistencia que no existe en el código.
  const gpRenglones = Object.values(GP).reduce((n, o) =>
    n + o.proveedores.reduce((m, p) => m + Object.keys(p.semanas).length, 0), 0);
  await escribir('global/gp_construct', {
    parserVersion: PARSER_VERSION,
    ultimaActualizacion: new Date(Date.now() - 3 * 3600000).toISOString(),
    fuente: 'api-gp-por-obra',
    semanasDisponibles: gpSemanas,
    ultimaSemana: 'S2026-01',
    mesesDisponibles: ['M2025-12', 'M2026-01'],
    ultimoMes: 'M2026-01',
    totalObras: Object.keys(GP).length,
    obrasPedidas: Object.keys(GP),
    obrasConError: [],
    obrasArrastradas: [],
    // Una obra de CAMPO sin código de 4 dígitos: no se puede pedir, y el panel
    // tiene que decirlo en vez de dejarla fuera callando.
    obrasSinClaveGP: [{ obraId: 'Bodega Minatitlán', nombre: 'Bodega Minatitlán' }],
    renglonesLeidos: gpRenglones + 2,
    // Los dos renglones de más son los que NO entraron a ninguna obra: uno sin
    // obra reconocible, con su importe, y un proveedor que la consulta entrega
    // en cero. Sembrados a propósito: dinero que está en la contabilidad y no
    // está en ninguna pantalla es justo lo que el panel existe para enseñar.
    descartes: { sinObra: 1, montoSinObra: 183450.75, proveedoresEnCero: 1 },
    obras: GP,
  });
  for (const [id, o] of Object.entries(GP)) {
    await escribir(`global/gp_detalle/obras/${id}`, {
      parserVersion: PARSER_VERSION,
      ultimaActualizacion: new Date(Date.now() - 3 * 3600000).toISOString(),
      fuente: 'api-gp-por-obra',
      ...o,
    });
  }
  // ── El catálogo de obras de GP: qué obras EXISTEN, sin dinero ──────────────
  //
  // Las 67 obras son las REALES, medidas el 2026-11-02 contra fosedy.org con el
  // recorrido completo (46,470 renglones). No están inventadas y no se recortan
  // a dos: el defecto que este documento cierra sólo se ve con la lista larga —
  // con cinco obras sembradas, un selector que ofrece cinco parece correcto.
  //
  // Sin montos a propósito: el catálogo contesta «qué obras hay», y el gasto de
  // una obra que CAMPO no tiene no le pertenece a nadie todavía.
  const CATALOGO_GP = [
    { id: '0001', nombre: "OFICINA CENTRAL", ultimoCheque: '2026-10-30' },
    { id: '0002', nombre: "TALLER", ultimoCheque: '2026-10-30' },
    { id: '0011', nombre: "OBRAS ANTERIORES", ultimoCheque: '2020-05-25' },
    { id: '0013', nombre: "TRANSPORTE FOSMON", ultimoCheque: '2026-10-13' },
    { id: '0019', nombre: "ACTIVO FIJO FOSMON", ultimoCheque: '2026-03-17' },
    { id: '0036', nombre: "COMPRAS FOSMON", ultimoCheque: '2026-10-29' },
    { id: '0037', nombre: "LICITACIONES FOSMON", ultimoCheque: '2026-10-30' },
    { id: '0038', nombre: "IMPUESTOS FOSMON", ultimoCheque: '2026-10-23' },
    { id: '0061', nombre: "PARQUE CENTRAL MIGUEL HIDALGO 1era Etapa", ultimoCheque: '2020-08-27' },
    { id: '0064', nombre: "AMPLIACION ELECTRIFICACION MANANTIAL", ultimoCheque: '2020-10-30' },
    { id: '0069', nombre: "PARQUE CENTRAL MIGUEL HIDALGO 2da Etapa", ultimoCheque: '2022-01-17' },
    { id: '0070', nombre: "REHABILITACION AZUFRE 1", ultimoCheque: '2020-10-16' },
    { id: '0071', nombre: "BACHOCO OLUTA", ultimoCheque: '2021-03-31' },
    { id: '0072', nombre: "BACHOCO CHINAMECA", ultimoCheque: '2020-07-29' },
    { id: '0073', nombre: "BACHOCO MONTAJE", ultimoCheque: '2020-12-30' },
    { id: '0074', nombre: "TUBERIA OLUTA", ultimoCheque: '2022-06-14' },
    { id: '0076', nombre: "RDB TORRES DE ENFRIAMIENTO (OBRA CIVIL)", ultimoCheque: '2024-08-29' },
    { id: '0077', nombre: "RDB INGENIERIA TORRES DE ENFRIAMIENTO", ultimoCheque: '2022-11-14' },
    { id: '0078', nombre: "RDB SUMINISTRO E INSTALACION DE TORRES D", ultimoCheque: '2024-04-19' },
    { id: '0079', nombre: "RDB SUBESTACION ELECTRICA", ultimoCheque: '2023-02-08' },
    { id: '0080', nombre: "PROYECTO MALECON", ultimoCheque: '2022-02-03' },
    { id: '0081', nombre: "RDB COMPLEMENTARIA TORRES", ultimoCheque: '2022-08-18' },
    { id: '0082', nombre: "TORRE MINATITLAN", ultimoCheque: '2023-09-19' },
    { id: '0083', nombre: "TORRES DE ENFRIAMIENTO DOS BOCAS", ultimoCheque: '2026-06-09' },
    { id: '0085', nombre: "SUPERVISION API", ultimoCheque: '2024-07-01' },
    { id: '0086', nombre: "TE 07 SALINA CRUZ", ultimoCheque: '2024-08-13' },
    { id: '0087', nombre: "BARDA REFINERIA MINATITLAN", ultimoCheque: '2025-06-25' },
    { id: '0088', nombre: "PEMEX MINA BARDA 2 0823", ultimoCheque: '2026-05-27' },
    { id: '0089', nombre: "PROCURA MATAPIONCHE", ultimoCheque: '2024-08-26' },
    { id: '0090', nombre: "PRO-AGROINDUSTRIA, SAIPEM", ultimoCheque: '2024-11-20' },
    { id: '0091', nombre: "EX-FABRICA TRIPLAY OAXACA", ultimoCheque: '2026-06-16' },
    { id: '0093', nombre: "PATIO DE CHATARRA, TAMSA", ultimoCheque: '2026-06-30' },
    { id: '0094', nombre: "LINDE SAN LUIS POTOSI OBRA CIVIL 0824", ultimoCheque: '2026-10-28' },
    { id: '0095', nombre: "Ex-Fabrica Triplay Oaxaca B", ultimoCheque: '2024-08-05' },
    { id: '0096', nombre: "FOSMON NAVE IND. CALZADAS 0824", ultimoCheque: '2026-10-30' },
    { id: '0097', nombre: "PEMEX MINA TORRE 100 0824", ultimoCheque: '2026-10-26' },
    { id: '0098', nombre: "COATZACOALCOS LAND DEVELOPMENT - TENARIS", ultimoCheque: '2026-06-09' },
    { id: '0099', nombre: "PROMOTORA OAXACA ESTADIO 0924", ultimoCheque: '2026-08-31' },
    { id: '0100', nombre: "TAMSA VER FAT 3 1024", ultimoCheque: '2026-06-16' },
    { id: '0101', nombre: "DESMANTELAMIENTO CASETA", ultimoCheque: '2025-10-03' },
    { id: '0102', nombre: "PEMEX MINA REPARACION BARDA 0225", ultimoCheque: '2026-06-16' },
    { id: '0103', nombre: "OBRA PLUVIAL PUENTE COATZA 1", ultimoCheque: '2026-06-09' },
    { id: '0104', nombre: "SIOP COATZA BACHEO CANGREJERA 0225", ultimoCheque: '2026-06-09' },
    { id: '0105', nombre: "TAMSA VER CONALEP T-LAB 0325", ultimoCheque: '2026-10-27' },
    { id: '0106', nombre: "FOSMON RIO CALZADAS 0325", ultimoCheque: '2026-10-30' },
    { id: '0107', nombre: "FOSMON BELLAVISTA 0325", ultimoCheque: '2026-10-29' },
    { id: '0109', nombre: "CENTRO DE CONVENCIONES 0425", ultimoCheque: '2026-10-30' },
    { id: '0110', nombre: "SIOP NANCHITAL REHAB. 0525", ultimoCheque: '2026-05-25' },
    { id: '0111', nombre: "TAMSA VER CRIBADO MATERIALES 0525", ultimoCheque: '2026-10-30' },
    { id: '0112', nombre: "SIOP COATZA MALECON 0526", ultimoCheque: '2026-10-29' },
    { id: '0113', nombre: "TEN VER DEMOLICIÓN DE OFICINAS DE PATIOS", ultimoCheque: '2025-12-19' },
    { id: '0114', nombre: "OAXACA PARQUE LINEAL 0825", ultimoCheque: '2026-10-31' },
    { id: '0115', nombre: "TAMSA VERACRUZ COMEDOR 0825", ultimoCheque: '2026-10-30' },
    { id: '0116', nombre: "LOSAS COMPLEMENTARIAS VERACRUZ", ultimoCheque: '2026-03-23' },
    { id: '0117', nombre: "SIOP COATZA REMODELACION CASETA 0925", ultimoCheque: '2026-08-31' },
    { id: '0119', nombre: "SIOP COATZA ENTRONQUE NANCHITAL 1125", ultimoCheque: '2026-08-31' },
    { id: '0120', nombre: "TAMSA VER MONTAJE DE ESTRUCTURA 1125", ultimoCheque: '2026-06-26' },
    { id: '0121', nombre: "SIOP COATZA REHAB. AV. UNIVERSIDAD 0226", ultimoCheque: '2026-10-31' },
    { id: '0122', nombre: "AYUNTAMIENTO COATZA MANTTO LOPEZ M 03226", ultimoCheque: '2026-03-27' },
    { id: '0123', nombre: "AYUNTAMIENTO COATZA EDIFICIOS 0226", ultimoCheque: '2026-09-09' },
    { id: '0124', nombre: "SIOP COATZA REHAB. PUENTE 0226", ultimoCheque: '2026-10-30' },
    { id: '0125', nombre: "TAMSA VER SERVICIOS ESPECIALIZADOS 0526", ultimoCheque: '2026-10-31' },
    { id: '0126', nombre: "PEMEX CANGREJERA TECHUMBRE 0526", ultimoCheque: '2026-10-31' },
    { id: '0127', nombre: "CENTRO DE CONVENCIONES MTTO 0626", ultimoCheque: '2026-10-31' },
    { id: '0128', nombre: "SIOP COLECTOR MALECON PENTAGONO 0926", ultimoCheque: '2026-10-30' },
    { id: '0129', nombre: "AYU-COAT-REHABILITACION DEL MALECON 0926", ultimoCheque: '2026-10-30' },
    { id: '0131', nombre: "SIOP COAT-EMISOR J. SPARK PENTAGONO 1026", ultimoCheque: '2026-10-22' },
  ];
  await escribir('global/gp_catalogo', {
    catalogoVersion: CATALOGO_GP_VERSION,
    ultimaActualizacion: new Date(Date.now() - 26 * 3600000).toISOString(),
    fuente: 'api-gp-completo',
    totalObras: CATALOGO_GP.length,
    // Los dos números son los medidos el 2026-11-02, no un relleno.
    renglonesLeidos: 46470,
    renglonesSinClave: 16,
    obrasRenombradas: [],
    obras: CATALOGO_GP,
  });

  console.log('obras de constructora: 0114, 0128, 0121 (en la raíz) + global/gp_construct');
  console.log('  programa: 0114 cuadra al peso · 0128 NO cuadra (#96) · 0121 sin programa');
  console.log('            OP-2026-002 NO cuadra del lado dependencia (#98): monto y fin, arranque sí');
  console.log(`  GP: parserVersion ${PARSER_VERSION} (leída de functions/index.js)`);
  console.log('  0114 con S2025-50-S2026-01 seguidas · 0121 con huecos (S2025-48, S2025-50, S2026-01)');
  console.log(`  fuente api-gp-por-obra · ${gpRenglones + 2} renglones · 1 sin obra ($183,450.75)`);
  console.log('  y su detalle en global/gp_detalle/obras/<id>, que es el que gana');
  console.log(`  catálogo aparte en global/gp_catalogo: ${CATALOGO_GP.length} obras, sin montos`);

  // ── Obras de la dependencia, BAJO SU ORGANIZACIÓN ─────────────────────────
  // Tres obras: una sana, una atrasada y una recién arrancada sin estimaciones
  // —para ver que "Pagado $0" se distingue de "no disponible"—.
  const P = 'orgs/coatzacoalcos/';
  await sembrarObra(P, 'OP-2026-001', {
    nombre: 'OBRA DEMO 1 — Rehabilitación de pavimento', contrato: 'MC-OP-2026-001',
    contratado: 12400000, cliente: 'H. Ayuntamiento de Coatzacoalcos',
    ubicacion: 'Col. Centro, Coatzacoalcos, Ver.',
    inicio: '2026-04-01', fin: '2026-11-30', semilla: 7, nPartidas: 12,
    empresa: 'Constructora del Golfo, S.A. de C.V.', rfc: 'CGO180412QX3',
    // CON LOS ESTADOS DEL TRÁMITE DE LA DEPENDENCIA, no los de la constructora.
    // Allá una estimación se elabora, se aprueba, se FACTURA y se cobra; aquí
    // se RECIBE en ventanilla, se revisa, se autoriza y se paga. Sembrar
    // «Facturada» de este lado no revienta nada —y ése es el problema—: el
    // desplegable no encuentra la opción, se queda en la primera, y la demo
    // enseña «Recibida» en una estimación que el guion sembró facturada. Nadie
    // ve el error; sólo ve un estado que no es.
    //
    // Y CON LAS CUATRO LECTURAS DEL PLAZO DE LEY, una por renglón: pagada
    // dentro de los 20 días del art. 63, pagada fuera, autorizada y todavía en
    // plazo, y autorizada con el plazo vencido —que es la que le cuesta dinero
    // al municipio y la que dispara la tarjeta—. Las cuatro juntas en una obra
    // porque lo que hay que poder mirar es si se DISTINGUEN entre sí; una sola
    // pastilla verde no dice si la roja se ve distinta.
    estimaciones: [
      { num: 1, monto: 2800000, estatus: 'pagada',      fecha: '2026-06-20',
        autorizada: '2026-06-25', pagada: '2026-07-10' },          // 15 d · en plazo
      { num: 2, monto: 3100000, estatus: 'pagada',      fecha: '2026-07-25',
        autorizada: '2026-07-30', pagada: '2026-08-28' },          // 29 d · 9 tarde
      { num: 3, monto: 2400000, estatus: 'en revisión', fecha: '2026-09-05' },
      { num: 4, monto: 1800000, estatus: 'autorizada',  fecha: haceDias(12),
        autorizada: haceDias(8) },                                 // dentro, corriendo
      { num: 5, monto: 2100000, estatus: 'autorizada',  fecha: haceDias(45),
        autorizada: haceDias(41) },                                // 21 d sobre el plazo
    ],
    semanas: 4, diasSinCaptura: 3, fotosSemanas: 5,
  });
  await sembrarObra(P, 'OP-2026-002', {
    nombre: 'OBRA DEMO 2 — Drenaje sanitario', contrato: 'MC-OP-2026-002',
    contratado: 8900000, cliente: 'H. Ayuntamiento de Coatzacoalcos',
    ubicacion: 'Col. Benito Juárez, Coatzacoalcos, Ver.',
    inicio: '2026-06-15', fin: '2026-10-30', semilla: 43, nPartidas: 9,
    // Con acento inicial a propósito: la columna ordena por clave normalizada,
    // y así se ve que «Áridos» cae junto a la A y no al final de la lista.
    empresa: 'Áridos y Asfaltos del Istmo, S.A. de C.V.', rfc: 'AAI210930M14',
    // SIN LAS FECHAS DEL PLAZO DE LEY, que es el estado de producción hoy: una
    // estimación pagada de la que el expediente no dice cuándo se autorizó ni
    // cuándo se pagó. Su renglón tiene que leerse como un hueco —gris, con el
    // dato que falta dicho en letra— y no como un «pagada en plazo».
    estimaciones: [{ num: 1, monto: 1900000, estatus: 'pagada', fecha: '2026-08-12' }],
    // Sin captura en 19 días: dispara la alerta que SÍ le sirve a una
    // dependencia, y así se ve que el recorte no la dejó ciega.
    // Ésta lleva además una foto sin `fecha` y otra guardada como cadena
    // suelta: las dos formas que tiene producción de no poder fechar una
    // foto. Van en una sola obra para poder ver ese grupo sin que domine.
    semanas: 2, diasSinCaptura: 19, fotosSemanas: 3, fotosSinFecha: true,
    // EL #98: el cuadre del anexo, del lado del municipio. La pantalla del
    // programa NO es de constructora —se llega por «Contrato → Catálogo de
    // conceptos»— y hasta el 2026-11-04 su ruta no tenía regla en Firestore,
    // así que el supervisor veía el cargador y la escritura rebotaba contra
    // el `match /{document=**}` final. Esta siembra existe para que la ruta se
    // recorra con datos, no sólo en el banco de reglas.
    //
    // El desacuerdo es DISTINTO al de la 0128 a propósito: aquí el arranque
    // SÍ coincide y sólo discrepan el monto y el fin. Así se ve que el aviso
    // enumera lo que no cuadra y se calla lo que sí, en vez de soltar las tres
    // líneas siempre. La historia es la del convenio: el alta se capturó con
    // el monto y el plazo ampliados, y el anexo que se cargó es el original.
    programa: {
      inicio: '2026-06-15', fin: '2026-10-15', formato: 'DE-5',
      obraDelArchivo: 'DRENAJE SANITARIO COL. BENITO JUAREZ',
      montos: [765000, 1530000, 2295000, 1912500, 1147500],
    },
  });
  await sembrarObra(P, 'OP-2026-003', {
    nombre: 'OBRA DEMO 3 — Alumbrado público', contrato: 'MC-OP-2026-003',
    contratado: 5600000, cliente: 'H. Ayuntamiento de Coatzacoalcos',
    ubicacion: 'Av. Universidad, Coatzacoalcos, Ver.',
    inicio: '2026-09-01', fin: '2027-02-28', semilla: 61, nPartidas: 7,
    // Sin `empresa` A PROPÓSITO: es el tercer estado de la columna, y si todas
    // las obras sembradas tuvieran contratista nunca se vería «sin capturar».
    estimaciones: [], semanas: 1, diasSinCaptura: 4, fotosSemanas: 1,
  });
  console.log('obras de dependencia: OP-2026-001/002/003 (bajo orgs/coatzacoalcos)');

  // ── BITÁCORA: MÁS FILAS QUE LA VENTANA ────────────────────────────────────
  //
  // La bitácora lee las últimas N por `ts desc` y el resto de los filtros los
  // aplica en memoria. Ese defecto NO SE VE con veinte filas sembradas: hay
  // que pasar del tope para que la pantalla tenga algo que no leyó. Producción
  // tiene 4,603 filas y la ventana por omisión le cubre seis días; aquí se
  // siembran 230, repartidas en meses, para que:
  //
  //   · con la ventana de 100 y de 200, la lectura quede TOPADA y el aviso de
  //     recorte tenga que salir;
  //   · con la de 500 quede completa, y el aviso tenga que desaparecer —media
  //     prueba es el caso en que la pantalla NO debe avisar—;
  //   · y haya filas de JUNIO, meses antes del piso de la ventana, que sólo se
  //     alcanzan si el filtro de fecha viaja a la consulta.
  //
  // Las fechas van de junio a noviembre con la mayoría apiladas en los últimos
  // días, como en producción: la ventana se llena de lo reciente y lo viejo
  // queda fuera. `ts` es cadena ISO, igual que lo que escribe la app.
  const BIT_OBRAS = ['0114', '0128', '0121'];
  const BIT_TIPOS = ['escritura', 'lectura', 'borrado'];
  const BIT_MODULOS = ['obras', 'avance', 'nomina', 'evidencia', 'estimaciones'];
  let bitFilas = 0;
  const sembrarFila = async (ts, i) => {
    await escribir(`auditoria/sem-${String(i).padStart(4, '0')}`, {
      ts,
      usuario: i % 3 === 0 ? 'demo@fosmon.com.mx' : 'residente@fosmon.com.mx',
      nombre: i % 3 === 0 ? 'Demo FOSMON' : 'Residente de obra',
      tipo: BIT_TIPOS[i % BIT_TIPOS.length],
      modulo: BIT_MODULOS[i % BIT_MODULOS.length],
      obraId: BIT_OBRAS[i % BIT_OBRAS.length],
      entidad: `obras/${BIT_OBRAS[i % BIT_OBRAS.length]}`,
      ok: true,
      mensaje: 'fila sembrada para ver la ventana de la bitácora',
    });
    bitFilas++;
  };
  // 200 recientes: 2026-11-01 a 2026-11-05, que es la pila que llena la ventana.
  for (let i = 0; i < 200; i++) {
    const dia = 5 - Math.floor(i / 50);
    const h = String(23 - (i % 24)).padStart(2, '0');
    const m = String(59 - (i % 60)).padStart(2, '0');
    await sembrarFila(`2026-11-${String(dia).padStart(2, '0')}T${h}:${m}:00.000Z`, i);
  }
  // 30 viejas: junio y julio. Son las que la ventana NO alcanza y las que una
  // pregunta por fecha tiene que poder encontrar.
  for (let i = 0; i < 30; i++) {
    const mes = i < 15 ? '06' : '07';
    const dia = String(2 + (i % 15) * 2).padStart(2, '0');
    await sembrarFila(`2026-${mes}-${dia}T1${i % 10}:30:00.000Z`, 1000 + i);
  }
  console.log(`bitácora: ${bitFilas} filas en auditoria — 200 del 1 al 5 de nov ` +
    `(llenan la ventana de 100 y de 200) y 30 de junio/julio, que quedan fuera`);

  console.log('\nEntra con cualquiera de las dos, misma contraseña:');
  for (const c of CUENTAS) console.log(`  ${c.correo.padEnd(24)} ${CLAVE}   (${c.tipo})`);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
