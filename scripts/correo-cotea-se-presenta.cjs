#!/usr/bin/env node
// El correo de una sola vez: «CAMPO ahora se llama cotea».
//
// QUÉ ES. Un anuncio al padrón entero. No es un correo de producto —no se
// dispara por nada, no lleva cifras de ninguna obra y después de mandarse no
// vuelve a servir—, así que NO vive en `functions/index.js`: una función
// desplegada que no se vuelve a llamar es código muerto con permisos.
//
// DE DÓNDE SALE EL FORMATO. El sobre, los botones y los párrafos se EXTRAEN de
// `functions/index.js`, no se copian. Si mañana cambia el encabezado de los
// correos de cotea, este anuncio cambia con él; una copia se habría quedado
// vieja el primer día.
//
// EL LOGO, NO EL EMBLEMA. Antes iba `/icon-192.png`, que es el emblema suelto:
// se veía el ícono, no la marca. El logo bueno es
// `src/assets/brand/cotea-horizontal.svg`, pero en correo un SVG remoto no lo
// pinta casi ningún cliente, así que se rasterizó a `public/cotea-horizontal.png`
// (480×136, 3× para pantalla retina) con el mismo Chrome que ya usa
// `prueba-puente-color.cjs`.
//
// Servirlo es el problema: `public/` no llega al aire hasta que se despliegue
// el front, y hoy `app.cotea.com.mx/cotea-horizontal.png` responde 404 —
// medido—. Así que el guion MIDE la URL antes de armar: si contesta 200 la usa,
// y si no, manda el PNG incrustado como adjunto `inline` con `content_id` y lo
// referencia con `cid:`. Resend acepta las dos formas (probado, 200). El correo
// sigue escrito para leerse **con las imágenes apagadas**: el nombre va en
// texto en el título, el logo es la marca, no el mensaje.
//
// LOS COLORES SON LOS DE LA MARCA, NO LOS DE LA APP. El header iba en
// `#0D1619`, que se ve negro, y no es cotea: es la paleta vieja de la interfaz.
// `src/styles/tokens.css` lo dice con todas sus letras —«hoy vale exactamente
// lo que valía la paleta C», la marca todavía no entra al puente—. Los colores
// de cotea están en el logo y son dos: pizarra `#4A5560` y naranja `#FF6B35`.
//
// Uso:
//   node scripts/correo-cotea-se-presenta.cjs                      (sólo arma)
//   node scripts/correo-cotea-se-presenta.cjs --a correo@dominio --enviar
//   node scripts/correo-cotea-se-presenta.cjs --a mi@gmail.com --como alguien@fosmon.com.mx --enviar
//   node scripts/correo-cotea-se-presenta.cjs --al-padron           (sólo arma)
//   node scripts/correo-cotea-se-presenta.cjs --al-padron --enviar --si-estoy-seguro
//
// **Por omisión no manda nada.** Mandar al padrón pide `--enviar` Y
// `--si-estoy-seguro`: es un correo que no se puede retirar.

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARCH_FN = path.join(RAIZ, 'functions/index.js');
const admin = require(path.join(RAIZ, 'functions/node_modules/firebase-admin'));
const { fuenteDe } = require('./extraer-de-app.cjs');

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? null : process.argv[i + 1];
};
const DESTINO = arg('--a');
// A quién se le arma el correo, cuando no es el mismo que lo recibe. Para
// revisar el anuncio antes de mandarlo hace falta ver el que de verdad le va a
// llegar a un usuario: un buzón de fuera del padrón no tiene perfil, así que
// saldría sin nombre de pila y sin el renglón del rol — media revisión.
const COMO = arg('--como');
const AL_PADRON = process.argv.includes('--al-padron');
const ENVIAR = process.argv.includes('--enviar');
const SEGURO = process.argv.includes('--si-estoy-seguro');

if (!DESTINO && !AL_PADRON) {
  console.error('Falta `--a correo@dominio` o `--al-padron`.');
  process.exit(2);
}

// ── Firestore de sólo lectura ───────────────────────────────────────────────
// El padrón se LEE. El 2026-10-09 un guion escribió 270 documentos en
// producción por no llevar esta guarda, así que va puesta y se auto-comprueba.
const PROHIBIDAS = new Set(['set', 'update', 'delete', 'create', 'add',
  'setAll', 'commit', 'bulkWriter', 'batch', 'runTransaction']);
const soloLectura = (obj, ruta = 'db') => new Proxy(obj, {
  get(destino, prop) {
    if (typeof prop === 'string' && PROHIBIDAS.has(prop)) {
      return () => {
        throw new Error(`ESCRITURA BLOQUEADA: ${ruta}.${prop}() — este guion es de sólo lectura`);
      };
    }
    const v = destino[prop];
    if (typeof v !== 'function') return v;
    return (...args) => {
      const r = v.apply(destino, args);
      if (r && typeof r === 'object' && (r.constructor?.name || '').includes('Reference')) {
        return soloLectura(r, `${ruta}.${String(prop)}()`);
      }
      return r;
    };
  },
});

admin.initializeApp({ projectId: 'campo-fosmon' });
const db = soloLectura(admin.firestore());
try {
  db.doc('global/gp_construct').set({ probando: true });
  console.error('NO ARRANCÓ: la guarda de sólo lectura no bloqueó una escritura.');
  process.exit(2);
} catch (e) {
  if (!/ESCRITURA BLOQUEADA/.test(e.message)) {
    console.error('NO ARRANCÓ: la guarda falló por otra razón:', e.message);
    process.exit(2);
  }
}

// ── el formato, extraído del código vivo ────────────────────────────────────
// Lo que se extrae son los HECHOS, no el adorno: a quién se le llama cómo, de
// dónde sale el correo y a dónde apunta. Si mañana cambia el remitente o la
// dirección de la app, este anuncio cambia con ellos. La pinta es propia —ver
// la nota de arriba—, así que `sobreCorreo` y sus ayudantes ya no se piden.
const PEDIDOS = ['ESC_HTML', 'marcaDeOrg', 'orgDeLaRaiz', 'rolVisible',
  'FROM_EMAIL', 'APP_URL'];
const { cuerpo, faltan } = fuenteDe(ARCH_FN, PEDIDOS);
if (faltan.length) {
  console.error(`NO ARRANCÓ: a functions/index.js le faltan ${faltan.join(', ')}`);
  process.exit(2);
}
// El nombre del rol en palabras NO está en el perfil: `rolLabel` lo manda el
// cliente al dar de alta y los perfiles de producción no lo guardan, así que
// `rolVisible` se cae —correctamente— al identificador y el correo decía «tu
// acceso sigue siendo el de gerente_construccion». La tabla vive en la app, que
// es lo que el usuario ya vio en pantalla, y de ahí se EXTRAE: una segunda
// tabla aquí diría «Supervisor de Obra» el día que un rol se renombre, que ya
// pasó una vez. Se sigue pasando por `rolVisible` para que el saneo sea el
// mismo que el de los demás correos.
const { cuerpo: fuenteRoles, faltan: faltanRoles } =
  fuenteDe(path.join(RAIZ, 'src/App.jsx'), ['ROL_LABEL']);
if (faltanRoles.length) {
  console.error('NO ARRANCÓ: a src/App.jsx le falta ROL_LABEL');
  process.exit(2);
}
const ROL_LABEL = new Function(`"use strict";\n${fuenteRoles}\nreturn ROL_LABEL;`)();

const requireFalso = (m) => (m === 'firebase-admin'
  ? { ...admin, initializeApp: () => {}, firestore: () => db }
  : require(m));
const fn = new Function('require',
  `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)(requireFalso);

const { ESC_HTML, APP_URL } = fn;

// ── la marca ────────────────────────────────────────────────────────────────
// Los dos colores de cotea, sacados del logo —son los únicos dos que trae
// `cotea-horizontal.svg`—, no de `tokens.css`, que todavía es la paleta vieja.
const PIZARRA = '#4A5560';
const NARANJA = '#FF6B35';
const TINTA   = '#14181C';  // el caliza de cotea: el del manifiesto, el de identidad
const GRIS    = '#6B7480';
const BORDE   = '#E8EAF0';

// Este anuncio NO usa `sobreCorreo`. Los demás correos son avisos: el sobre
// gris con el header oscuro está hecho para no estorbar, y está bien que así
// sea. Éste es el único correo cuyo tema ES la marca, y pintarlo con la
// plantilla de los avisos fue el defecto: salía un anuncio de cambio de marca
// sin la marca. Lo que sí se extrae del código vivo son los HECHOS —la
// dirección, el remitente, el nombre del rol, la empresa—, que es donde una
// copia se pudre.
const LOGO_ALTO = 46;   // 160×46 en el correo; el PNG va a 3× para retina
const LOGO_ANCHO = 160;

function sobreDeMarca({ marca, titulo, entradilla, cuerpoHTML, pie, logoSrc }) {
  const firma = marca?.empresa ? ESC_HTML(marca.empresa) : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:28px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid ${BORDE};">
        <tr><td style="height:4px;background:${NARANJA};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:26px 30px 20px 30px;background:#FFFFFF;">
          <img src="${logoSrc}" width="${LOGO_ANCHO}" height="${LOGO_ALTO}" alt="cotea"
               style="display:block;border:0;">
          ${firma ? `<div style="font-size:10px;color:${GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:12px;">${firma}</div>` : ''}
        </td></tr>
        <tr><td style="padding:0 30px 6px 30px;">
          <div style="font-size:21px;font-weight:700;color:${TINTA};line-height:1.3;">${ESC_HTML(titulo)}</div>
          ${entradilla ? `<div style="font-size:14px;color:${PIZARRA};line-height:1.6;margin-top:11px;">${entradilla}</div>` : ''}
        </td></tr>
        <tr><td style="padding:6px 30px 28px 30px;">${cuerpoHTML}</td></tr>
        <tr><td style="padding:18px 30px;background:#FAFBFC;font-size:11px;color:${GRIS};text-align:center;border-top:1px solid ${BORDE};">
          ${ESC_HTML(pie)}<br>
          <a href="${APP_URL}" style="color:${NARANJA};text-decoration:none;font-weight:600;">${APP_URL.replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const parrafo = (html) =>
  `<p style="font-size:14px;color:${PIZARRA};line-height:1.68;margin:0 0 14px 0;">${html}</p>`;

const boton = (texto, url) =>
  `<a href="${url}" style="display:inline-block;background:${NARANJA};color:#FFFFFF;` +
  `text-decoration:none;font-size:14px;font-weight:700;padding:13px 26px;border-radius:8px;">` +
  `${ESC_HTML(texto)}</a>`;

// ── el contenido ────────────────────────────────────────────────────────────
// Todo lo que este correo afirma del producto está en la app: los cuatro tabs
// y sus sub-tabs son los de `CAMPO_CONTEXTO.md` §4. No se prometen módulos que
// no existan — un correo a todo el padrón que promete de más es una cifra
// inventada con otra ropa.
const SECCION = (titulo, renglones) =>
  `<div style="margin:22px 0 4px 0;">` +
  `<div style="font-size:11px;font-weight:700;color:${NARANJA};text-transform:uppercase;letter-spacing:0.09em;">${ESC_HTML(titulo)}</div>` +
  renglones.map(([que, para]) =>
    `<div style="margin-top:10px;">` +
    `<span style="font-size:14px;font-weight:700;color:${TINTA};">${ESC_HTML(que)}</span>` +
    `<span style="font-size:14px;color:${PIZARRA};"> — ${ESC_HTML(para)}</span>` +
    `</div>`).join('') +
  `</div>`;

// Los pasos del final. Sin numerito: son tres recordatorios, no un
// procedimiento, y numerarlos los hacía ver más pesados de lo que son.
const APUNTES = (titulo, renglones) =>
  `<div style="margin:26px 0 0 0;padding:16px 18px;background:#FAFBFC;border:1px solid ${BORDE};border-radius:9px;">` +
  `<div style="font-size:11px;font-weight:700;color:${GRIS};text-transform:uppercase;letter-spacing:0.09em;">${ESC_HTML(titulo)}</div>` +
  renglones.map((t) =>
    `<div style="font-size:13px;color:${PIZARRA};line-height:1.6;margin-top:9px;">${t}</div>`).join('') +
  `</div>`;

function armar({ nombre, rol, rolLabel, marca, logoSrc }) {
  const pila = String(nombre || '').trim().split(' ')[0] || 'Hola';
  const soyCliente = rol === 'cliente' || rol === 'contratista';
  const dir = APP_URL.replace(/^https?:\/\//, '');

  const cuerpoHTML =
    parrafo(`Es el mismo sistema que ya usas. Las mismas obras, el mismo ` +
      `histórico, tu misma cuenta y tu misma contraseña. Lo que cambió es el ` +
      `nombre, y vale la pena contar por qué.`) +

    parrafo(`<b>CAMPO</b> era un acrónimo: Control de Avance, Maquinaria, ` +
      `Personal y Obra. Cuatro módulos, cuatro cajones. Nombraba bien lo que ` +
      `el sistema tenía el primer día, pero una obra no se lleva en cajones ` +
      `separados.`) +

    parrafo(`<b>cotea</b> viene de <b>cotejar</b>: poner una cosa junto a la ` +
      `otra para ver si cuadran. Lo planeado contra lo ejecutado. El ` +
      `presupuesto contra el gasto. Lo que se vio en campo contra lo que llegó ` +
      `a la oficina. Eso es llevar una obra, y es justamente lo que cuatro ` +
      `cajones separados no pueden hacer solos.`) +

    `<div style="margin:22px 0;padding:20px 22px;background:${TINTA};border-radius:10px;border-left:4px solid ${NARANJA};">` +
    `<div style="font-size:15px;color:#FFFFFF;line-height:1.6;font-weight:600;">` +
    `Ya no son cuatro módulos. Es la obra entera en un solo lugar, ` +
    `en la palma de tu mano, a cualquier hora.</div>` +
    `<div style="font-size:13px;color:${NARANJA};margin-top:10px;font-weight:700;letter-spacing:0.03em;">` +
    `cotea · Tu obra, al momento.</div>` +
    `</div>` +

    parrafo(`Una obra se gana o se pierde en los días que nadie miró. Cuando ` +
      `el avance se sabe el martes y no el viernes, todavía se puede hacer ` +
      `algo; cuando una desviación se ve mientras está pasando, se corrige en ` +
      `vez de explicarse. Esa diferencia —entre enterarse a tiempo y ` +
      `enterarse después— es la que separa una obra que se controla de una ` +
      `que sólo se documenta.`) +

    parrafo(`Para eso es cotea: para que la obra se vea completa mientras ` +
      `todavía se puede decidir sobre ella. No al cierre, cuando ya nada más ` +
      `queda justificar.`) +

    (soyCliente
      ? SECCION('Lo que ves en cotea', [
        ['Avance', 'cómo va tu obra, semana por semana'],
        ['Fotos', 'el respaldo de lo que se reporta'],
        ['Estimaciones', 'lo estimado y su estatus'],
        ['Plazos', 'las fechas del contrato y sus ampliaciones'],
      ])
      : SECCION('Todo junto, en un solo lugar', [
        ['Dashboard', 'los indicadores de la obra y los riesgos que el sistema detecta solo'],
        ['Operación', 'el reporte de la semana: avance físico, almacén, maquinaria, nómina, estimaciones y subcontratos'],
        ['Gastos', 'lo que se gastó, por proveedor, por rubro y por semana'],
        ['Planeación', 'el contrato con sus plazos y documentos, y el presupuesto'],
      ])) +

    `<div style="margin:26px 0 6px 0;">${boton('Entrar a cotea', APP_URL)}</div>` +
    `<div style="font-size:12px;color:${GRIS};">${dir}</div>` +

    APUNTES('Antes de entrar', [
      `Guarda la dirección nueva: <b style="color:${TINTA};">${dir}</b>. La ` +
      `anterior va a seguir funcionando por tiempo limitado.`,
      `Si tienes la app instalada en el teléfono, bórrala y vuélvela a agregar ` +
      `desde la dirección nueva para que quede con el nombre y el ícono de cotea.`,
      `Los correos ahora llegan de <b style="color:${TINTA};">no-reply@cotea.com.mx</b>. ` +
      `Si alguno cae en spam, márcalo como correo deseado.`,
    ]) +

    parrafo(`<span style="display:block;margin-top:24px;">El nombre es nuevo. ` +
      `Las obras que hay detrás, y el trabajo que costaron, no. Gracias por ` +
      `eso.</span>`);

  return {
    subject: 'CAMPO ahora es cotea',
    html: sobreDeMarca({
      marca,
      logoSrc,
      titulo: 'CAMPO ahora es cotea',
      entradilla: `${ESC_HTML(pila)}, el sistema con el que llevas las obras ` +
        `cambió de nombre` + (rolLabel ? `. Tu acceso sigue siendo el de <b>${ESC_HTML(rolLabel)}</b>` : '') + `.`,
      cuerpoHTML,
      pie: 'Este correo se manda una sola vez, por el cambio de nombre.',
    }),
  };
}

// ── armar y, si se pidió, mandar ────────────────────────────────────────────
// El identificador del logo dentro del mensaje. Cualquier cadena sirve
// mientras el `src="cid:…"` y el `content_id` digan lo mismo.
const CID_LOGO = 'logo-cotea';

// `enviarEmailResend` del código vivo desestructura `{from,to,subject,html}` y
// tira todo lo demás, así que por ahí no pasa un adjunto. No se ensancha: ese
// es el camino por donde salen TODOS los correos de la app y abrirlo para un
// anuncio que se manda una vez sería mover la pieza de en medio por la orilla.
// Esta es la misma llamada, con `attachments`.
async function mandar(apiKey, cuerpo) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Resend error ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

const leerLlaveResend = () => require('child_process')
  .execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest',
    '--secret=RESEND_API_KEY', '--project=campo-fosmon'], { encoding: 'utf8' }).trim();

(async () => {
  const orgRaiz = await fn.orgDeLaRaiz(db);
  const marca = await fn.marcaDeOrg(orgRaiz);

  let gente;
  if (AL_PADRON) {
    const snap = await db.collection('usuarios').get();
    gente = snap.docs.map((d) => d.data() || {})
      // `activo !== false` y no `=== true`: un perfil creado a mano no trae el
      // campo, y no tenerlo es estar activo. Es el mismo criterio que
      // `perfilesDeOrg`.
      .filter((u) => u.email && u.activo !== false)
      .sort((a, b) => String(a.email).localeCompare(String(b.email)));
  } else {
    const buscado = COMO || DESTINO;
    const snap = await db.collection('usuarios')
      .where('email', '==', buscado).limit(1).get();
    if (COMO && snap.empty) {
      console.error(`NO ARRANCÓ: ${COMO} no está en el padrón, así que no hay `
        + 'perfil del que armar el correo.');
      process.exit(2);
    }
    const perfil = snap.empty ? null : snap.docs[0].data();
    // El sobre se arma con el perfil de `--como` pero se entrega a `--a`: eso
    // es la copia de revisión.
    gente = [{ ...(perfil || { nombre: buscado.split('@')[0] }), email: DESTINO }];
  }

  // ── cómo va a viajar el logo ──────────────────────────────────────────────
  // No se adivina: se MIDE. Si `public/cotea-horizontal.png` ya está en el
  // aire, se referencia por URL y el correo pesa 6 KB. Si todavía no se
  // despliega el front, viaja incrustado. Las dos formas pintan el mismo PNG;
  // la diferencia es que la incrustada no depende de un despliegue y la de URL
  // no suma 16 KB a cada copia.
  const PNG = path.join(RAIZ, 'public/cotea-horizontal.png');
  if (!fs.existsSync(PNG)) {
    console.error(`NO ARRANCÓ: falta ${PNG}, que es el logo del correo.`);
    process.exit(2);
  }
  const urlLogo = `${APP_URL}/cotea-horizontal.png`;
  const enElAire = await fetch(urlLogo, { method: 'HEAD' })
    .then((r) => r.ok).catch(() => false);
  const logoSrc = enElAire ? urlLogo : `cid:${CID_LOGO}`;
  const adjuntos = enElAire ? [] : [{
    filename: 'cotea.png',
    content: fs.readFileSync(PNG).toString('base64'),
    content_id: CID_LOGO,
    disposition: 'inline',
  }];

  console.log('');
  console.log(`CAMPO ahora es cotea — ${gente.length} destinatario(s)`);
  console.log(`   marca:   ${marca.empresa || '(sin marca)'}`);
  console.log(`   logo:    ${enElAire ? `por URL (${urlLogo} contesta 200)`
    : `incrustado — ${urlLogo} todavía no está en el aire`}`);
  const armados = gente.map((u) => {
    const rolLabel = u.rol
      ? fn.rolVisible(u.rol, u.rolLabel || ROL_LABEL[u.rol]) : '';
    const { subject, html } = armar({ nombre: u.nombre, rol: u.rol, rolLabel, marca, logoSrc });
    return { to: u.email, subject, html, nombre: u.nombre || u.email, rolLabel };
  });
  for (const a of armados) {
    console.log(`   ${String(a.to).padEnd(30)} ${String(a.rolLabel || '—').padEnd(26)} ${a.html.length} bytes`);
  }
  const muestra = path.join('/tmp', 'cotea-se-presenta.html');
  fs.writeFileSync(muestra, armados[0].html);
  console.log(`   HTML de muestra: ${muestra}`);

  console.log('');
  if (!ENVIAR) {
    console.log('Nada se mandó. Falta `--enviar`.');
    process.exit(0);
  }
  if (AL_PADRON && !SEGURO) {
    console.error('Al padrón entero hace falta además `--si-estoy-seguro`: '
      + 'este correo no se puede retirar.');
    process.exit(2);
  }

  const apiKey = leerLlaveResend();
  let mandados = 0;
  for (const a of armados) {
    const r = await mandar(apiKey, {
      from: fn.FROM_EMAIL, to: [a.to], subject: a.subject, html: a.html,
      attachments: adjuntos,
    });
    if (!r.id) {
      console.error(`ROJO  ${a.to}  →  NO SALIÓ: ${JSON.stringify(r)}`);
      process.exit(1);
    }
    console.log(`mandado  ${String(a.to).padEnd(30)} (Resend id ${r.id})`);
    mandados++;
  }
  console.log('');
  console.log(`${mandados} de ${armados.length} con acuse de Resend.`);
  process.exit(mandados === armados.length ? 0 : 1);
})().catch((e) => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
