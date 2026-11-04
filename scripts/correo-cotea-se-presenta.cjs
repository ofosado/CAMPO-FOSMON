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
// POR QUÉ EL ÍCONO Y NO EL LOGO HORIZONTAL. El logo bueno
// (`src/assets/brand/cotea-horizontal.svg`) no se sirve por URL pública, y en
// correo un SVG remoto no se ve en casi ningún cliente. `/icon-192.png` sí
// está publicado y medido (200, 4,853 bytes). Y el correo está escrito para
// leerse **con las imágenes apagadas**, que es como llega por omisión en
// Outlook y en Gmail de escritorio: el ícono es un adorno, el nombre va en
// texto.
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
const PEDIDOS = ['sobreCorreo', 'botonHTML', 'parrafoHTML', 'avisoHTML',
  'pasosHTML', 'ESC_HTML', 'marcaDeOrg', 'orgDeLaRaiz', 'rolVisible',
  'enviarEmailResend', 'FROM_EMAIL', 'APP_URL'];
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
  `"use strict";\n${cuerpo}\nreturn { sobreCorreo, botonHTML, parrafoHTML, avisoHTML,
     pasosHTML, ESC_HTML, marcaDeOrg, orgDeLaRaiz, rolVisible, enviarEmailResend,
     FROM_EMAIL, APP_URL };`)(requireFalso);

const { sobreCorreo, botonHTML, parrafoHTML, pasosHTML, ESC_HTML, APP_URL } = fn;

// ── el contenido ────────────────────────────────────────────────────────────
// Todo lo que este correo afirma del producto está en la app: los cuatro tabs
// y sus sub-tabs son los de `CAMPO_CONTEXTO.md` §4. No se prometen módulos que
// no existan — un correo a todo el padrón que promete de más es una cifra
// inventada con otra ropa.
const SECCION = (titulo, renglones) =>
  `<div style="margin:18px 0 0 0;">` +
  `<div style="font-size:11px;font-weight:700;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.07em;">${ESC_HTML(titulo)}</div>` +
  renglones.map(([que, para]) =>
    `<div style="margin-top:9px;">` +
    `<span style="font-size:13px;font-weight:700;color:#0D1619;">${ESC_HTML(que)}</span>` +
    `<span style="font-size:13px;color:#4A5160;"> — ${ESC_HTML(para)}</span>` +
    `</div>`).join('') +
  `</div>`;

function armar({ nombre, rol, rolLabel, marca }) {
  const pila = String(nombre || '').trim().split(' ')[0] || 'Hola';
  const soyCliente = rol === 'cliente' || rol === 'contratista';

  const cuerpoHTML =
    // El ícono, arriba y chico. Si el cliente de correo bloquea imágenes
    // —lo normal—, queda el `alt` y no se pierde nada: el nombre va en texto
    // en el encabezado y en el título.
    `<div style="margin:0 0 18px 0;">` +
    `<img src="${APP_URL}/icon-192.png" width="52" height="52" alt="cotea"` +
    ` style="display:block;border:0;border-radius:11px;">` +
    `</div>` +

    parrafoHTML(`Es el mismo sistema que ya usas. Las mismas obras, el mismo ` +
      `histórico, tu misma cuenta y tu misma contraseña. Lo que cambió es el ` +
      `nombre y la dirección.`) +

    parrafoHTML(`<b>CAMPO</b> era una sigla —Control de Avance, Maquinaria, ` +
      `Personal y Obra— y describía los módulos que tenía el primer día. ` +
      `<b>cotea</b> no describe módulos: describe para qué sirve.`) +

    `<div style="margin:20px 0;padding:16px 18px;background:#0D1619;border-radius:9px;">` +
    `<div style="font-size:19px;font-weight:700;color:#FFFFFF;letter-spacing:0.04em;">cotea</div>` +
    `<div style="font-size:13px;color:#C9CED6;margin-top:4px;">Tu obra, al momento.</div>` +
    `</div>` +

    parrafoHTML(`Antes una obra se llevaba entre un Excel que vivía en una ` +
      `computadora y un WhatsApp donde las cosas se decían una vez y se ` +
      `perdían. Para saber cómo iba una obra había que preguntarle a alguien, ` +
      `y la respuesta dependía de a quién le preguntaras y de qué tan ` +
      `actualizado estuviera su archivo.`) +

    parrafoHTML(`La idea de cotea es que esa pregunta tenga <b>una sola ` +
      `respuesta</b> y que esté a la mano: lo que se captura en campo se ve en ` +
      `la oficina en el momento, con el nombre de quien lo capturó. Una cifra ` +
      `que no se capturó no se rellena con un cero — se dice que falta. Eso es ` +
      `todo el proyecto.`) +

    (soyCliente
      ? SECCION('Lo que ves en cotea', [
        ['Avance', 'cómo va tu obra, semana por semana'],
        ['Fotos', 'el respaldo de lo que se reporta'],
        ['Estimaciones', 'lo estimado y su estatus'],
        ['Plazos', 'las fechas del contrato y sus ampliaciones'],
      ])
      : SECCION('Lo que tienes adentro', [
        ['Dashboard', 'los indicadores de la obra y los riesgos que el sistema detecta solo'],
        ['Operación', 'el reporte de la semana: avance físico, almacén, maquinaria, nómina, estimaciones y subcontratos'],
        ['Gastos', 'lo que se gastó, por proveedor, por rubro y por semana'],
        ['Planeación', 'el contrato con sus plazos y documentos, y el presupuesto'],
      ])) +

    `<div style="margin:22px 0 4px 0;">${botonHTML('Entrar a cotea', APP_URL)}</div>` +
    `<div style="font-size:12px;color:#9AA0AC;margin-bottom:4px;">${APP_URL.replace(/^https?:\/\//, '')}</div>` +

    pasosHTML('Tres cosas que conviene hacer hoy', [
      `Guarda la dirección nueva: <b>${APP_URL.replace(/^https?:\/\//, '')}</b>. ` +
      `La de antes sigue funcionando, no se va a apagar de golpe.`,
      `Si tienes cotea instalada en el teléfono, <b>bórrala y vuélvela a ` +
      `agregar</b> desde la dirección nueva. No es que se rompa: iOS se queda ` +
      `con el ícono y el nombre que guardó al instalarla, así que si no lo ` +
      `haces va a seguir diciendo CAMPO en tu pantalla de inicio.`,
      `Los correos de cotea ahora llegan de <b>no-reply@cotea.com.mx</b>. ` +
      `Si alguno cae en spam, márcalo como correo deseado para que los ` +
      `siguientes lleguen bien.`,
    ]) +

    parrafoHTML(`Si algo no te cuadra o ves un número que no deberías estar ` +
      `viendo, dilo. Un dato mal puesto que nadie reporta se vuelve el dato ` +
      `con el que se decide.`);

  return {
    subject: 'CAMPO ahora se llama cotea',
    html: sobreCorreo({
      marca,
      titulo: 'CAMPO ahora se llama cotea',
      entradilla: `${ESC_HTML(pila)}, el sistema con el que llevas las obras ` +
        `cambió de nombre` + (rolLabel ? `. Tu acceso sigue siendo el de <b>${ESC_HTML(rolLabel)}</b>` : '') + `.`,
      cuerpoHTML,
      pie: 'Este correo se manda una sola vez, por el cambio de nombre.',
    }),
  };
}

// ── armar y, si se pidió, mandar ────────────────────────────────────────────
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

  console.log('');
  console.log(`CAMPO ahora se llama cotea — ${gente.length} destinatario(s)`);
  console.log(`   marca:   ${marca.empresa || '(sin marca)'}`);
  const armados = gente.map((u) => {
    const rolLabel = u.rol
      ? fn.rolVisible(u.rol, u.rolLabel || ROL_LABEL[u.rol]) : '';
    const { subject, html } = armar({ nombre: u.nombre, rol: u.rol, rolLabel, marca });
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
    const r = await fn.enviarEmailResend(apiKey, {
      from: fn.FROM_EMAIL, to: [a.to], subject: a.subject, html: a.html,
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
