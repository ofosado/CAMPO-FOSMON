#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA COBERTURA DE EVIDENCIA SE MIDE EN DINERO — PENDIENTES #105
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ AFIRMA EL EXPEDIENTE AHORA. Hasta el 2026-11-05 la sección de fotos del
// PDF de obra sólo PRESENTABA doce fotos. Ahora AFIRMA algo sobre ellas: dice
// qué porcentaje del contrato está respaldado, y cuando no alcanza lo dice con
// una frase y en rojo. Eso lo cambia de categoría: es un documento con tres
// firmas y la cifra tiene que ser defendible renglón por renglón.
//
// LAS TRES MANERAS DE MENTIR QUE ESTE BANCO EXISTE PARA IMPEDIR:
//
//   1. CONTAR FOTOS Y LLAMARLO COBERTURA. Mil fotos del señalamiento no
//      respaldan nada; una foto de la partida que vale la mitad del contrato
//      respalda la mitad. El fixture está armado para que las dos cuentas
//      DISCREPEN en los dos sentidos: con fotos sólo en las partidas chicas,
//      contar da 60% y el dinero da 20%; con la foto sólo en la grande,
//      contar da 20% y el dinero da 50%. Una vara que se equivoque se cae de
//      un lado o del otro, pero se cae.
//
//   2. PUBLICAR CERO CUANDO NO SE PUDO LEER. `fsColl` devuelve `[]` cuando la
//      regla niega o la red falla, así que una lectura fallida y una obra sin
//      fotos llegan a la cuenta con la misma lista vacía. «0.0% · la evidencia
//      no alcanza» impreso por una lectura denegada es una cifra creíble y
//      falsa. Medido en producción el 2026-11-05: tres de las siete obras
//      vivas salen en 0.0% de verdad, así que esa cifra VA A SALIR impresa y
//      hay que poder distinguir cuál de las dos es.
//
//   3. PUBLICAR EL NÚMERO CUANDO EL NÚMERO NO ES LA NOTICIA. Debajo del piso
//      la noticia no es «31.2%», es que el expediente no está respaldado. Un
//      porcentaje suelto se lee como una medición cumplida. Esto no es estilo:
//      es la decisión que él tomó —«con que superemos el 50% es suficiente»— y
//      la mitad de abajo de esa decisión es que ahí no se publica cifra.
//
// SE EJECUTA, NO SE LEE. La cuenta, las frases y las dos varas se extraen de
// `src/App.jsx` y se corren. Y el PDF también se corre, con el jsPDF falso de
// `lienzo-pdf.cjs`: lo que el banco afirma de la banda es lo que quedaría en el
// papel, no que exista una función que la dibuje.
//
// NINGUNA FRASE ESPERADA ESTÁ TECLEADA AQUÍ. Lo que se compara contra lo que
// imprime el PDF sale de llamar a `frasesDeCobertura` con los mismos datos.
// Teclear la frase sería comprobar el banco contra sí mismo, y además dejaría
// el banco rojo el día que se corrija una coma. Lo que sí se afirma a mano es
// la PROPIEDAD: que debajo del piso no haya ningún dígito en el título.
//
// Uso:  node scripts/prueba-la-cobertura-se-mide-en-dinero.cjs
//       node scripts/prueba-la-cobertura-se-mide-en-dinero.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

// `textoCorrido` pega los renglones de un mismo párrafo. La banda del veredicto
// es una frase larga que el generador parte en varios renglones para que quepa,
// así que buscarla renglón por renglón no la encuentra nunca —y el banco
// acusaría al papel de callarse algo que sí dice—.
const { dibujarPDF, textoCorrido } = require('./lienzo-pdf.cjs');

const PEDIDOS = [
  'coberturaDeEvidencia', 'frasesDeCobertura',
  'COBERTURA_TECHO', 'COBERTURA_PISO',
  'generarPDFObra',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── El fixture: un catálogo donde el dinero y el conteo NO coinciden ────────
//
// Los importes están elegidos para que el techo caiga exactamente entre la
// segunda y la tercera partida (500 + 300 = 80% de 1000), para que el banco
// pueda afirmar `hastaTecho` sin que el número dependa de un redondeo.
const CAT = [
  { sec: '1000 01', sub: 'Terracerías',   imp: 500 },
  { sec: '1000 02', sub: 'Pavimento',     imp: 300 },
  { sec: '1000 03', sub: 'Guarniciones',  imp: 100 },
  { sec: '1000 04', sub: 'Banquetas',     imp:  60 },
  { sec: '1000 05', sub: 'Señalamiento',  imp:  40 },
];
// Autorizada después de firmar, y cara: si entrara en el denominador, el solo
// hecho de autorizarla bajaría la cobertura del expediente de 50% a 36%.
const EXTRA = { sec: 'EX 01', sub: 'Obra extraordinaria', imp: 400, extra: true };

const TOTAL_CAT = 1000;   // la suma de CAT, a mano, para que el banco se cuide
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

let nFoto = 0;
const foto = (partidaId, campos = {}) => ({
  id: `F${++nFoto}`, partidaId, url: PNG,
  fechaServidor: '2026-10-01T10:00:00.000Z', verificada: true,
  sub: campos.sub || '', ...campos,
});

// Las partidas chicas fotografiadas y las dos grandes no: 3 de 5 por conteo
// (60%, pasa el piso) y 200 de 1000 por dinero (20%, no lo pasa).
const SOLO_CHICAS = [foto('1000 03'), foto('1000 04'), foto('1000 05')];
// Al revés: 1 de 5 por conteo (20%, no pasa) y 500 de 1000 por dinero (50%, sí).
const SOLO_GRANDE = [foto('1000 01')];

const cob = (fn, evidencia, opciones = {}) => fn.coberturaDeEvidencia({
  subs: opciones.subs || CAT, evidencia,
  ...(('evidenciaCargada' in opciones) ? { evidenciaCargada: opciones.evidenciaCargada } : {}),
});

const OBRA = {
  id: '0114', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001',
  presupuesto: TOTAL_CAT, inicio: '2026-01-01', fin: '2026-12-31',
};

// Los `sec` que el pie de cada foto imprime, en el orden en que el PDF los
// dibujó. Es el orden en que el expediente ENSEÑA la evidencia.
//
// `d.tabla === undefined` NO es un detalle de implementación: desde que el
// expediente imprime la TABLA de partidas grandes sin evidencia, la clave de
// una partida aparece en la hoja por dos caminos distintos —el pie de una foto
// y una celda de esa tabla— con exactamente el mismo texto. Sin este filtro
// este lector contaba la fila de la tabla como si fuera una foto, y «la primera
// foto del expediente» se cumplía o fallaba según qué tan arriba quedó una
// tabla. El lienzo distingue las dos: `text()` lleva `x`/`y`, `autoTable` lleva
// `tabla`/`celda`.
const SECS = new Set([...CAT.map(s => s.sec), EXTRA.sec]);
const ordenImpreso = (dibujos) =>
  dibujos.filter(d => d.tabla === undefined && SECS.has(d.texto)).map(d => d.texto);

async function correr(fuente) {
  const fn = construir(fuente);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const casi = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.05;

  // ── 0 · EL FIXTURE DISCREPA DE VERDAD ─────────────────────────────────────
  // Si las dos varas dieran lo mismo con este catálogo, todo lo de abajo
  // pasaría por la razón equivocada. Esto no prueba la app: protege al banco.
  const chicas = cob(fn, SOLO_CHICAS);
  const grande = cob(fn, SOLO_GRANDE);
  const pctConteo = (c) => (c.partidasConFoto / c.partidas) * 100;
  check(chicas.total === TOTAL_CAT && grande.total === TOTAL_CAT,
    'el denominador es el importe del catálogo del fixture',
    `${chicas.total} y ${grande.total} contra ${TOTAL_CAT}`);
  check(pctConteo(chicas) > chicas.pct + 20 && pctConteo(grande) < grande.pct - 20,
    'y contar partidas se separa del dinero en los DOS sentidos',
    `chicas: conteo ${pctConteo(chicas).toFixed(0)}% vs dinero ${chicas.pct.toFixed(0)}% · ` +
    `grande: conteo ${pctConteo(grande).toFixed(0)}% vs dinero ${grande.pct.toFixed(0)}%`);

  // ── 1 · SE MIDE EN DINERO ─────────────────────────────────────────────────
  check(casi(chicas.pct, 20),
    'tres partidas chicas con foto respaldan el 20% del contrato, no el 60%',
    `publica ${chicas.pct.toFixed(1)}%`);
  check(casi(grande.pct, 50),
    'y una sola foto en la partida grande respalda el 50%, no el 20%',
    `publica ${grande.pct.toFixed(1)}%`);

  // ── 2 · UNA PARTIDA CUENTA ENTERA, Y UNA VEZ ──────────────────────────────
  // La foto no dice a qué volumen corresponde —no hay campo que lo diga— así
  // que repartir el importe entre sus fotos sería inventar la cifra. Y por el
  // otro lado: tres tomas de la misma partida no respaldan el triple.
  const triple = cob(fn, [foto('1000 01'), foto('1000 01'), foto('1000 01')]);
  check(casi(triple.pct, 50) && triple.partidasConFoto === 1,
    'tres fotos de la misma partida respaldan lo mismo que una',
    `${triple.pct.toFixed(1)}% con ${triple.partidasConFoto} partida cubierta`);

  // ── 3 · UNA FOTO ANULADA NO RESPALDA NADA ─────────────────────────────────
  // Anular no es borrar: el documento se queda para que el expediente conserve
  // que alguien subió algo. Lo que pierde es el valor de evidencia.
  const conAnulada = cob(fn, [foto('1000 01'), foto('1000 02', { anulada: true })]);
  check(casi(conAnulada.pct, 50),
    'una foto anulada no suma al respaldo del contrato',
    `con la anulada contada daría 80% · publica ${conAnulada.pct.toFixed(1)}%`);

  // ── 4 · AUTORIZAR UNA EXTRAORDINARIA NO BAJA LA COBERTURA ─────────────────
  // La extraordinaria no está en el contrato que se firmó. Si entrara en el
  // denominador, autorizarla castigaría el expediente sin que nadie dejara de
  // tomar una sola foto.
  const conExtra = cob(fn, [foto('1000 01'), foto(EXTRA.sec)],
    { subs: [...CAT, EXTRA] });
  check(casi(conExtra.pct, 50) && conExtra.partidas === CAT.length,
    'la extraordinaria, con foto y todo, no entra en el contrato medido',
    `${conExtra.pct.toFixed(1)}% sobre ${conExtra.partidas} partidas de ${CAT.length}`);

  // ── 5 · «NO SE PUDO LEER» NO ES «CERO» ────────────────────────────────────
  const noLeida = cob(fn, [], { evidenciaCargada: false });
  check(noLeida.medible === false && noLeida.razon === 'no-leida',
    'con la evidencia sin leer, la cobertura no es medible y dice por qué',
    `medible ${noLeida.medible} · razón ${noLeida.razon}`);
  check(noLeida.pct === null,
    'y el porcentaje es `null`, nunca 0: cero es una afirmación',
    `pct = ${JSON.stringify(noLeida.pct)}`);
  const fNoLeida = fn.frasesDeCobertura(noLeida);
  check(!/\d/.test(fNoLeida.titulo) && /no quiere decir que no haya fotos/i.test(fNoLeida.detalle),
    'la frase no acusa a la obra de no tener fotos: acusa a la lectura',
    fNoLeida.detalle);

  // ── 6 · UN CATÁLOGO SIN IMPORTES NO SE PUEDE PONDERAR ─────────────────────
  // Es distinto de «no se leyó» y peor que «no hay catálogo»: hay partidas que
  // enseñar y ninguna manera de pesarlas. Las obras 0198 y 0199 del emulador
  // están así.
  const sinImportes = cob(fn, [foto('1000 01')],
    { subs: CAT.map(s => ({ ...s, imp: 0 })) });
  check(sinImportes.medible === false && sinImportes.razon === 'sin-importes',
    'un catálogo sin importes no es medible, y no por la misma razón',
    `razón ${sinImportes.razon}`);
  const fSinImp = fn.frasesDeCobertura(sinImportes);
  check(/importes?/i.test(fSinImp.detalle) && fSinImp.detalle !== fNoLeida.detalle,
    'y su frase habla de importes, no de una lectura que falló',
    fSinImp.detalle);

  // ── 7 · EL ORDEN Y LA LISTA DE TRABAJO ────────────────────────────────────
  // `porImporte` es el orden con el que se calculó el número y también el orden
  // en que el PDF enseña las fotos: así el documento no puede publicar una
  // cifra sacada de un orden y enseñar las fotos de otro.
  check(JSON.stringify(chicas.porImporte.map(x => x.id)) ===
        JSON.stringify(CAT.map(s => s.sec)),
    'las partidas se ordenan de mayor a menor importe',
    chicas.porImporte.map(x => x.id).join(' · '));
  // 500 + 300 = 80% justo: la tercera ya no hace falta para llegar al techo.
  check(chicas.hastaTecho === 2,
    `para llegar al ${fn.COBERTURA_TECHO}% bastan las 2 partidas de mayor importe`,
    `dice ${chicas.hastaTecho} de ${chicas.partidas}`);
  check(JSON.stringify(chicas.faltan.map(x => x.id)) ===
        JSON.stringify(['1000 01', '1000 02']),
    'y la lista de trabajo son esas dos, que son justo las que no tienen foto',
    chicas.faltan.map(x => x.id).join(' · ') || '(vacía)');
  check(grande.faltan.length === 1 && grande.faltan[0].id === '1000 02',
    'fotografiada la grande, sólo queda pendiente la segunda',
    grande.faltan.map(x => x.id).join(' · ') || '(vacía)');

  // ── 8 · DEBAJO DEL PISO NO SE PUBLICA EL NÚMERO ───────────────────────────
  // La decisión es suya: «con que superemos el 50% es suficiente». La mitad de
  // abajo de esa decisión es que ahí la noticia no es la cifra.
  const fChicas = fn.frasesDeCobertura(chicas);
  const fGrande = fn.frasesDeCobertura(grande);
  const casiTodo = cob(fn, [foto('1000 01'), foto('1000 02'), foto('1000 03')]);
  const fCasiTodo = fn.frasesDeCobertura(casiTodo);
  check(chicas.pct < fn.COBERTURA_PISO && !/\d/.test(fChicas.titulo),
    'debajo del piso el título no lleva ni un dígito: dice que no alcanza',
    `${chicas.pct.toFixed(1)}% → «${fChicas.titulo}»`);
  check(fChicas.titulo !== fGrande.titulo && /%/.test(fGrande.titulo),
    'arriba del piso sí se publica, y el título es otro',
    `«${fGrande.titulo}»`);
  check(casiTodo.pct >= fn.COBERTURA_TECHO && /%/.test(fCasiTodo.titulo) &&
        new RegExp(`${fn.COBERTURA_TECHO}%`).test(fCasiTodo.detalle),
    'arriba del techo el detalle dice que ya superó lo que el expediente exige',
    `${casiTodo.pct.toFixed(1)}% → «${fCasiTodo.detalle}»`);

  // ── 9 · LO QUE QUEDA EN EL PAPEL ──────────────────────────────────────────
  // Ejecutado, no leído. Y comparado contra `frasesDeCobertura`, no contra una
  // cadena tecleada: si el PDF redactara su propia versión del veredicto, los
  // dos textos se separarían y el que se quede viejo afirmaría lo que ya no es.
  const dibujar = (datos) => dibujarPDF(fn.generarPDFObra, {}, OBRA,
    { subs: CAT, ...datos });

  const papelChicas = await dibujar({ evidencia: SOLO_CHICAS });
  const textos = textoCorrido(papelChicas).map(d => d.texto);
  const pagDe = (re) => {
    const d = papelChicas.find(x => re.test(x.texto));
    return d ? d.pagina : null;
  };
  // LAS HOJAS SON LAS QUE LAS FOTOS NECESITAN. Hasta el 2026-11-06 el
  // expediente traía DOS hojas de seis huecos tecleadas a mano, siempre, y este
  // banco afirmaba que las dos seguían ahí. Con las tres fotos de este fixture
  // eso son NUEVE CAJAS GRISES impresas y firmadas, que no es un defecto de
  // maquetación: una hoja de evidencia mayormente vacía se hojea sin leerse, y
  // el hueco que importa —la partida grande que no tiene con qué respaldarse—
  // se pierde entre los que sólo son sitio de sobra. Lo que se afirma es la
  // relación, no el número: tres fotos caben en una hoja y no se parten en dos.
  const hojasFoto = papelChicas.filter(d => /EVIDENCIA FOTOGRÁFICA/.test(d.texto));
  check(hojasFoto.length === 1 && !/\bde \d+\)/.test(hojasFoto[0].texto),
    'con tres fotos el expediente abre UNA hoja de evidencia, no dos con nueve huecos',
    `abrió ${hojasFoto.length}: ${hojasFoto.map(h => h.texto).join(' | ') || '(ninguna)'}`);
  const pag1 = hojasFoto[0]?.pagina ?? null;
  const bandasTitulo = papelChicas.filter(d => d.texto === fChicas.titulo);
  check(bandasTitulo.length === 1 && bandasTitulo[0].pagina === pag1,
    'el veredicto de cobertura queda impreso, y en la primera página de fotos',
    `${bandasTitulo.length} vez(ces), página ${bandasTitulo[0]?.pagina} de ${pag1}`);
  check(textos.includes(fChicas.detalle),
    'y el renglón de abajo es exactamente el que redacta la cuenta',
    `«${fChicas.detalle}»`);
  check(!textos.some(t => t !== fChicas.titulo && /cobertura/i.test(t) && /%/.test(t)),
    'en el papel no aparece ningún otro «cobertura %» que lo contradiga');

  // Y LAS DOS PARTIDAS GRANDES SIN FOTO SE DECLARAN. Son el 80% del contrato y
  // ninguna tiene evidencia; el criterio viejo las filtraba con
  // `.filter(x => x.fotos.length > 0)` y el expediente salía enseñando tres
  // fotos de banquetas y señalamiento sin decir que terracerías y pavimento
  // —el 80% del dinero— no tienen una sola.
  const celdas = papelChicas.filter(d => d.tabla !== undefined).map(d => d.texto);
  check(celdas.includes('1000 01') && celdas.includes('1000 02'),
    'las dos partidas del 80% sin evidencia salen declaradas en una tabla',
    `claves en tablas: ${celdas.filter(t => SECS.has(t)).join(' , ') || '(ninguna)'}`);

  // La banda es un veredicto, no un decorado: repetirla en cada página la
  // volvería membrete y se dejaría de leer. Hace falta un papel de DOS hojas
  // para que esto afirme algo: con las tres fotos de arriba no hay segunda
  // página donde repetirse, y la aserción se cumpliría sola. Ocho fotos de la
  // partida de mayor importe abren dos.
  const papelDosHojas = await dibujar({
    evidencia: Array.from({ length: 8 }, () => foto('1000 01')),
  });
  const hojas2 = papelDosHojas.filter(d => /EVIDENCIA FOTOGRÁFICA/.test(d.texto));
  check(hojas2.length === 2 && /\(1 de 2\)/.test(hojas2[0].texto) &&
        /\(2 de 2\)/.test(hojas2[1].texto),
    'ocho fotos abren dos hojas, y cada una dice cuál de cuántas es',
    `abrió ${hojas2.length}: ${hojas2.map(h => h.texto).join(' | ')}`);
  const fOcho = fn.frasesDeCobertura(cob(fn, Array.from({ length: 8 }, () => foto('1000 01'))));
  check(papelDosHojas.filter(d => d.texto === fOcho.detalle).length === 1,
    'y la banda del veredicto no se repite en la segunda hoja',
    `salió ${papelDosHojas.filter(d => d.texto === fOcho.detalle).length} vez(ces)`);

  // El orden impreso: lo que se ve es lo que pesa. Hasta el 2026-11-05 el
  // criterio era el delta de avance de la semana, y la partida de mayor
  // importe no salía si esa semana no se tocó.
  const papelOrden = await dibujar({
    subs: [...CAT, EXTRA],
    evidencia: [foto('1000 01'),
                foto('1000 05'), foto('1000 05'), foto('1000 05'),
                foto(EXTRA.sec)],
  });
  const orden = ordenImpreso(papelOrden);
  check(orden[0] === '1000 01',
    'la primera foto del expediente es la de la partida que más pesa',
    `orden impreso: ${orden.join(' → ')}`);
  check(orden.indexOf('1000 05') < orden.indexOf(EXTRA.sec) &&
        orden.includes(EXTRA.sec),
    'y la extraordinaria se enseña —existe— pero después del contrato',
    `orden impreso: ${orden.join(' → ')}`);

  // ── 10 · SIN COBERTURA MEDIBLE, LAS FOTOS NO DESAPARECEN ──────────────────
  // Esta es una regresión que ya escribí una vez: tomar la lista de fotos de
  // `cobertura.porImporte` deja el expediente SIN NINGUNA foto cuando la
  // cobertura no se pudo medir, que es exactamente el caso en que más falta
  // hace enseñar lo que hay.
  const papelNoLeida = await dibujar({
    subs: [...CAT, EXTRA],
    evidencia: [foto('1000 01'), foto(EXTRA.sec)],
    evidenciaCargada: false,
  });
  const ordenNoLeida = ordenImpreso(papelNoLeida);
  check(ordenNoLeida.includes('1000 01') && ordenNoLeida.includes(EXTRA.sec),
    'sin cobertura medible el expediente sigue enseñando las fotos que hay',
    `orden impreso: ${ordenNoLeida.join(' → ') || '(ninguna)'}`);
  const textosNoLeida = textoCorrido(papelNoLeida).map(d => d.texto);
  check(textosNoLeida.includes(fNoLeida.detalle),
    'y la banda dice que no se pudo medir, sin publicar un 0%',
    `«${fNoLeida.detalle}»`);
  // Ojo con el alcance: el papel SÍ dice «0.0% del contrato» en el KPI de
  // avance físico, y con razón —este fixture no trae estimaciones—. Lo que no
  // puede aparecer es una COBERTURA con cifra, porque la cobertura no se midió.
  check(!textosNoLeida.some(t => /cobertura/i.test(t) && /\d/.test(t)),
    'y en ninguna parte del papel hay una cobertura con cifra',
    textosNoLeida.filter(t => /cobertura/i.test(t)).join(' | ') || '(ninguna)');

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver a mentir, no de romper el
// andamiaje: el banco sigue arrancando y ejecutando, y tiene que salir ROJO.
const MUTACIONES = [
  // Las tres mentiras del preámbulo, una por una.
  ['cuenta partidas en vez de dinero',
    'pct: (cubierto / total) * 100,',
    'pct: (cat.filter(x => conFoto.has(x.id)).length / cat.length) * 100,'],
  ['publica 0% cuando la lectura de evidencia falló',
    'if (!evidenciaCargada) return vacio(\'no-leida\');',
    'if (false) return vacio(\'no-leida\');'],
  ['el «no se pudo medir» sale con un cero en vez de sin cifra',
    'medible: false, razon, pct: null, total: 0, cubierto: 0,',
    'medible: false, razon, pct: 0, total: 0, cubierto: 0,'],
  ['debajo del piso vuelve a publicar el porcentaje a secas',
    "titulo: 'La evidencia fotográfica no alcanza para respaldar este expediente',",
    'titulo: `Cobertura de evidencia ${pct} del contrato`,'],
  // La extraordinaria castigando al expediente.
  ['la extraordinaria se cuela al denominador del contrato',
    'const cat = soloCatalogo(subs || [])',
    'const cat = (subs || [])'],
  // Anular dejando de ser anular.
  ['una foto anulada vuelve a respaldar el contrato',
    'const conFoto = new Set(evidenciaVigente(evidencia).map(e => e.partidaId));',
    'const conFoto = new Set((evidencia || []).map(e => e.partidaId));'],
  // Un catálogo sin importes dando por bueno un NaN.
  ['un catálogo sin importes sigue adelante y publica aritmética de cero',
    "if (total <= 0) return vacio('sin-importes');",
    "if (false) return vacio('sin-importes');"],
  // Las dos razones intercambiadas: cada una acusando a quien no es.
  ['las dos frases de «no medible» se cruzan',
    "if (!c.medible) return c.razon === 'no-leida'",
    "if (!c.medible) return c.razon === 'sin-importes'"],
  // El orden, que decide qué se ve y también la lista de trabajo.
  ['el orden por importe se invierte',
    'const porImporte = [...cat].sort((a, b) => b.imp - a.imp);',
    'const porImporte = [...cat].sort((a, b) => a.imp - b.imp);'],
  ['la lista de trabajo se estira hasta el 100% y deja de ser corta',
    'if ((acum / total) * 100 >= COBERTURA_TECHO) break;',
    'if ((acum / total) * 100 >= 100) break;'],
  // El PDF.
  ['el expediente deja de imprimir el veredicto',
    'if (conBanda) yf = drawHuecosDeEvidencia(drawBandaCobertura(yf));',
    'if (conBanda) yf = drawHuecosDeEvidencia(yf);'],
  ['la banda se repite en todas las hojas y se vuelve membrete',
    'const y = drawFotoPage(fotos12.slice(h * POR_HOJA, (h + 1) * POR_HOJA), titulo, h === 0);',
    'const y = drawFotoPage(fotos12.slice(h * POR_HOJA, (h + 1) * POR_HOJA), titulo, true);'],
  ['las hojas vuelven a ser dos siempre, con los huecos que haga falta',
    'const hojas = Math.max(1, Math.ceil(fotos12.length / POR_HOJA));',
    'const hojas = 2;'],
  ['el expediente deja de declarar las partidas grandes sin evidencia',
    'if (conBanda) yf = drawHuecosDeEvidencia(drawBandaCobertura(yf));',
    'if (conBanda) yf = drawBandaCobertura(yf);'],
  ['el PDF enseña las fotos en un orden distinto del que midió',
    'const enCorte = cobertura.porImporte.slice(0, cobertura.hastaTecho);',
    'const enCorte = [...cobertura.porImporte].reverse().slice(0, cobertura.hastaTecho);'],
  ['el PDF abre el apéndice de extraordinarias antes de terminar el contrato',
    `    .sort((a, b) => (esExtraordinaria(a.s) ? 1 : 0) - (esExtraordinaria(b.s) ? 1 : 0)
                 || b.imp - a.imp)`,
    '    .sort((a, b) => b.imp - a.imp)'],
  ['el PDF sólo enseña fotos de las partidas que ponderan',
    'for (const p of [...seleccion.partidas, ...seleccion.fuera]) {',
    'for (const p of [...seleccion.partidas]) {'],
];

(async () => {
  if (process.argv.includes('--contraprueba')) {
    console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
    let sobrevivieron = 0;
    for (const [titulo, de, a] of MUTACIONES) {
      if (!cuerpo.includes(de)) {
        console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje en la fuente`);
        process.exit(2);
      }
      let fallos;
      process.env.CALLADO = '1';
      try { fallos = await correr(cuerpo.replace(de, a)); }
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

  console.log('LA COBERTURA DE EVIDENCIA SE MIDE EN DINERO · #105\n');
  const fallos = await correr(cuerpo);
  if (fallos.length) {
    console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nverde');
  process.exit(0);
})();
