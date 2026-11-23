#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA PORTADA LLEVA LOS DOS LOGOS, Y CADA UNO DONDE SE VE
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ HABÍA. La portada de los dos papeles escribía `T('cotea', …)` a 30 pt en
// Helvetica bold: la palabra, no la marca. Y del cliente no había nada, aunque
// desde el #144 su logo se sube por Configuración → Marca y vive en
// `orgs/{oid}/config/branding`.
//
// ── LAS TRES COSAS QUE SE AFIRMAN, Y POR QUÉ ──────────────────────────────
//
// 1. EL LOGO DE COTEA ES UNA IMAGEN Y NO DEPENDE DE LA RED. `jsPDF.addImage`
//    no hace fetch, y la app es una PWA que genera reportes desde la obra. El
//    PNG viaja incrustado en el bundle (`?inline`), así que el papel sale igual
//    sin señal. Lo que se afirma es que la portada DIBUJA una imagen, no que
//    exista una constante.
//
// 2. SI NO SE PUEDE PINTAR, VUELVE LA PALABRA. Un papel con la esquina
//    superior izquierda vacía no se lee como «falló una imagen»: se lee como un
//    documento de nadie. El respaldo no es cosmética, es lo que impide que un
//    fallo de imagen produzca un documento sin emisor.
//
// 3. EL LOGO DEL CLIENTE VA EN EL PANEL CLARO. El campo se llama `logoBlanco`
//    y eso engaña: significa «el del fondo BLANCO», no «el logo en blanco». Es
//    el que la app pinta en su cabecera clara. Sobre el panel pizarra de la
//    izquierda sería oscuro sobre oscuro —invisible, y la marca de alguien
//    maltratada por nosotros—. Se eligió ese panel primero, y lo desmintió el
//    comentario de `PantallaMarca` antes de llegar al PDF; esta aserción es
//    para que no se vuelva a elegir mal.
//
// Y SIN LOGO DEL CLIENTE NO SE PINTA NADA: ni recuadro ni «sin logo». La
// organización ya va nombrada en la lista de identificación, así que el hueco
// no deja al lector sin saber de quién es el papel.
//
// CONTRAPRUEBAS — corridas el 2026-11-22, las cinco en ROJO (1), ninguna en
// NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-la-portada-lleva-los-logos.cjs
//       node scripts/prueba-la-portada-lleva-los-logos.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m, d = '') => {
  if (c) { verdes++; console.log(`  ok   ${m}${d ? '  ·  ' + d : ''}`); }
  else { fallas++; console.log(`FALLA  ${m}${d ? '  ·  ' + d : ''}`); }
};

// Un PNG de verdad de un píxel: `addImage` recibe una imagen, no una cadena
// cualquiera. Un doble que no es imagen haría fallar lo que el original
// soporta, y eso es inventarle un defecto al código que se mide.
const PNG_1PX = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
  + 'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PEDIDOS = ['generarPDFInterno', 'generarPDFArt73'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true,
  excluir: ['coteaBlancoPNG'] });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltan.join(', ')}`);
  process.exit(2);
}

// EL LOGO SE INYECTA, no se deja indefinido. Es un `import` de Vite, así que
// fuera del bundle no existe; si se dejara caer, el `try` del generador lo
// atraparía y el banco mediría siempre el camino del RESPALDO creyendo que
// mide el normal. Inyectándolo, el camino de la imagen se recorre de verdad —y
// la contraprueba que rompe el logo puede distinguirse del caso bueno.
const montar = (logoCotea) => {
  try {
    return new Function('React', 'useState', 'useEffect', 'useRef', 'useCallback',
      'useMemo', 'coteaBlancoPNG',
      `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)(
      ...Array(6).fill(() => {}), logoCotea);
  } catch (e) {
    console.error(`\nNO ARRANCÓ: no se pudo montar lo extraído: ${e.message}`);
    process.exit(2);
  }
};

const SELLO = '2026-03-15T18:00:00.000Z';
const OBRA = { id: '0114', nombre: 'Oaxaca Parque Lineal', cliente: 'Gobierno de Oaxaca',
               contrato: 'LO-920-2026-0114', inicio: '2026-03-01', fin: '2026-12-15' };
const base = (extra = {}) => ({
  obra: OBRA, subs: [], estimaciones: [], estCargadas: true, maquinaria: [],
  materiales: [], subcontratos: [], historialAvance: [], gpData: null,
  gpDetalle: null, otrosGastos: [], nominaHistorial: [], programa: null,
  instante: SELLO, evidencia: [], evidenciaCargada: true,
  organizacion: 'H. Ayuntamiento de Coatzacoalcos',
  generadoPor: 'oscar@cotea.com.mx', ...extra,
});

const dibujar = async (gen, props) => {
  const hoja = await dibujarPDFInterno(gen, props);
  if (hoja.reventones.length) {
    console.error(`\nNO ARRANCÓ: el generador reventó: ${hoja.reventones.join(' | ')}`);
    process.exit(2);
  }
  return hoja;
};

// El ancho de página del andamio, para saber qué mitad es cuál. Se lee del
// archivo y no se teclea: el panel oscuro ocupa `PW*0.42`.
const PW = Number((/const PW=(\d+)/.exec(fs.readFileSync(archivo, 'utf8')) || [])[1]);
if (!PW) { console.error('\nNO ARRANCÓ: no se pudo leer `PW` del andamio.'); process.exit(2); }
const FIN_PANEL_OSCURO = PW * 0.42;

(async () => {
const APP = montar(PNG_1PX);
const enPortada = (hoja) => hoja.imagenes.filter(i => i.pagina === 1);

// ══════════════════════════════════════════════════════════════════════════
console.log('1. El logo de cotea se dibuja, y no es la palabra escrita');

const sinCliente = await dibujar(APP.generarPDFInterno, base());
const imgs1 = enPortada(sinCliente);
ok(imgs1.length === 1,
  'la portada dibuja UNA imagen cuando la organización no tiene logo',
  `${imgs1.length} imagen(es)`);
ok(imgs1.length === 1 && imgs1[0].x < FIN_PANEL_OSCURO,
  'y va en el panel oscuro, que es donde la marca blanca se ve',
  imgs1.length ? `x=${imgs1[0].x} · el panel acaba en ${FIN_PANEL_OSCURO.toFixed(0)}` : '—');
// La palabra ya no se escribe cuando el logo sí se pudo pintar: si saliera
// además del logo, la portada diría «cotea» dos veces.
const textos1 = sinCliente.filter(d => d.pagina === 1).map(d => String(d.texto));
ok(!textos1.includes('cotea'),
  'y la palabra «cotea» ya no se escribe suelta: el logo la sustituye');

console.log('\n2. Si el logo no se puede pintar, vuelve la palabra');
// Se monta con un logo ROTO: `addImage` lanza y el generador cae al respaldo.
// Es el caso real de un bundle servido a medias o un PNG corrupto.
const APP_ROTO = montar('esto no es una imagen');
const conRoto = await dibujar(APP_ROTO.generarPDFInterno, base());
ok(enPortada(conRoto).length === 0, 'con el logo roto no se dibuja ninguna imagen');
ok(conRoto.filter(d => d.pagina === 1).map(d => String(d.texto)).includes('cotea'),
  'pero la palabra vuelve: la portada no se queda sin emisor');

console.log('\n3. El logo del cliente va en el panel CLARO');
const conCliente = await dibujar(APP.generarPDFInterno,
  base({ logoOrganizacion: PNG_1PX }));
const imgs2 = enPortada(conCliente);
ok(imgs2.length === 2, 'con logo de la organización la portada dibuja DOS imágenes',
  `${imgs2.length}`);
const delCliente = imgs2.filter(i => i.x >= FIN_PANEL_OSCURO);
ok(delCliente.length === 1,
  'y una de ellas cae en el panel claro — `logoBlanco` es el del fondo BLANCO, '
  + 'y sobre el pizarra sería invisible',
  imgs2.map(i => `x=${i.x}`).join(' · '));
// Cuadrado, porque la app ya lo encajó en 220 px de lado: estirarlo sería
// deformar la marca de alguien.
ok(delCliente.length === 1 && delCliente[0].w === delCliente[0].h,
  'y entra en caja cuadrada, sin estirarse',
  delCliente.length ? `${delCliente[0].w}×${delCliente[0].h}` : '—');

// UN LOGO EN SVG NO SE INTENTA PINTAR. `addImage` no sabe SVG, y hay marcas
// guardadas así —el sembrador del preview tenía una, y las organizaciones
// viejas pueden tenerla—. Intentarlo tira una excepción a media portada; lo
// correcto es callarse, igual que con el hueco.
console.log('\n3b. Un logo en SVG no se intenta pintar');
const SVG_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>');
const conSVG = await dibujar(APP.generarPDFInterno, base({ logoOrganizacion: SVG_URI }));
ok(enPortada(conSVG).length === 1,
  'con un logo SVG la portada dibuja sólo el de cotea, no lo intenta',
  `${enPortada(conSVG).length} imagen(es)`);
ok(conSVG.filter(d => d.pagina === 1).length > 5,
  'y la portada sale entera: no revienta a media hoja',
  `${conSVG.filter(d => d.pagina === 1).length} textos`);

console.log('\n4. Sin logo del cliente no se pinta un hueco');
ok(imgs1.length === 1,
  'sin logo, la portada sigue con una sola imagen: la de cotea');
ok(!textos1.some(t => /sin logo|logotipo/i.test(t)),
  'y no escribe «sin logo» ni dibuja un marcador de posición');
// La organización NO se queda sin nombrar, que es lo que haría grave el hueco.
ok(textos1.some(t => t.includes('H. Ayuntamiento de Coatzacoalcos')),
  'la organización sigue NOMBRADA en la identificación');

console.log('\n5. El informe del Art. 73 lleva los mismos dos');
const art73 = await dibujar(APP.generarPDFArt73,
  base({ logoOrganizacion: PNG_1PX }));
const imgs73 = enPortada(art73);
ok(imgs73.length === 2, 'su portada también dibuja los dos logos', `${imgs73.length}`);
ok(imgs73.some(i => i.x < FIN_PANEL_OSCURO) && imgs73.some(i => i.x >= FIN_PANEL_OSCURO),
  'y cada uno en su panel, igual que el otro papel',
  imgs73.map(i => `x=${i.x}`).join(' · '));

console.log(`\n${verdes} en verde · ${fallas} en rojo`);
if (fallas) process.exit(1);

// ══════════════════════════════════════════════════════════════════════════
// CONTRAPRUEBA
// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const src = fs.readFileSync(archivo, 'utf8');
  const CP = require('./contraprueba.cjs');
  const MUTANTES = [
    { titulo: 'la portada vuelve a escribir la palabra en vez del logo',
      cambios: [["    doc.addImage(coteaBlancoPNG, 'PNG', ML, 26, LOGO_ANCHO_MM,\n"
                 + "                 LOGO_ANCHO_MM * LOGO_PROPORCION, '', 'FAST');",
                 "    st(Q.wh); fs(30); fw('bold'); T('cotea', ML, 40);", 2]] },
    { titulo: 'el respaldo desaparece y un logo roto deja la portada sin emisor',
      cambios: [["    console.warn('el logo de cotea no se pudo pintar en la portada:', e?.message || e);\n"
                 + "    st(Q.wh); fs(30); fw('bold'); T('cotea', ML, 40);",
                 "    console.warn('el logo de cotea no se pudo pintar en la portada:', e?.message || e);", 2]] },
    { titulo: 'el logo del cliente se va al panel oscuro, donde no se ve',
      cambios: [["                     xR, PH-FTR-LOGO_ORG_CAJA_MM-8,",
                 "                     ML, PH-FTR-LOGO_ORG_CAJA_MM-8,", 2]] },
    { titulo: 'un logo que no es PNG ni JPEG se intenta pintar igual',
      cambios: [["    const fmtLogo = /^data:image\\/(png|jpe?g)/i.exec(String(logoOrganizacion || ''));",
                 "    const fmtLogo = logoOrganizacion ? ['', 'png'] : null;", 2]] },
    { titulo: 'el logo del cliente se estira a lo ancho del panel',
      cambios: [["                   LOGO_ORG_CAJA_MM, LOGO_ORG_CAJA_MM, '', 'FAST');",
                 "                   LOGO_ORG_CAJA_MM * 2, LOGO_ORG_CAJA_MM, '', 'FAST');", 2]] },
  ];
  CP.exigirAnclajes(MUTANTES, src, { archivo });
  const s = CP.correr({ mutaciones: MUTANTES, src, archivo, prefijo: 'portada-logos-' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}
})();
