#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ PORCENTAJE DEL CONTRATO TIENE FOTO? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El criterio para el expediente quedó decidido así: las partidas se
// ordenan por importe de mayor a menor, se publica el PORCENTAJE DEL CONTRATO
// QUE TERMINÓ CON FOTO, el techo es 80% —arriba de ahí no se pide más— y por
// debajo del 50% el documento dice que la evidencia no alcanza en lugar de
// imprimir el número pelón.
//
// Esas dos fronteras no se pueden calibrar contra el emulador, donde las fotos
// están sembradas. La pregunta es cuánto cubre HOY la evidencia real. Si todas
// las obras salen arriba del 80%, la frase de «no alcanza» es código muerto;
// si todas salen abajo del 50%, entonces la única cosa que el expediente va a
// decir siempre es «no alcanza», y eso hay que saberlo ANTES de construir el
// número bonito que nunca se va a imprimir.
//
// LA COBERTURA NO SE MIDE EN FOTOS, SE MIDE EN DINERO. Mil fotos de la partida
// de señalamiento no cubren la obra; una foto de la partida que vale el 30%
// del contrato cubre el 30%. Por eso cada partida CUENTA ENTERA O NO CUENTA:
// una partida con al menos una foto vigente aporta todo su importe de
// catálogo. No hay fracciones de partida porque no hay dato que las soporte
// —la foto no sabe a qué volumen corresponde— y repartir el importe entre las
// fotos sería inventar la cifra.
//
// LA CUENTA SE EXTRAE DE LA APP, NO SE REESCRIBE. La cobertura la calcula
// `coberturaDeEvidencia` —la misma función que publica el expediente— y
// `frasesDeCobertura` redacta el veredicto. Este guion nació con su propia
// copia, que estuvo bien el primer día porque la cuenta todavía no existía en
// la app; en cuanto existió, la copia se retiró. Dos cuentas del mismo número
// es lo que aquí se llama un defecto esperando: el día que el techo se mueva,
// se mueve en un solo lado.
//
// `evidenciaDeObra` es la única puerta a las fotos y ya sabe que una obra sin
// migrar las guarda en el arreglo viejo y una migrada en la subcolección;
// `idDePartida` es el id con el que la foto encuentra a su partida.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-cobertura-de-evidencia.cjs --prod
//
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-cobertura-de-evidencia.cjs

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { deApp } = require('./extraer-de-app.cjs');
const {
  evidenciaDeObra, idDePartida, importeCatalogoPartida, soloCatalogo,
  coberturaDeEvidencia, frasesDeCobertura, COBERTURA_TECHO, COBERTURA_PISO,
} = deApp('evidenciaDeObra', 'idDePartida', 'importeCatalogoPartida', 'soloCatalogo',
         'coberturaDeEvidencia', 'frasesDeCobertura',
         'COBERTURA_TECHO', 'COBERTURA_PISO');

// Las dos fronteras también vienen de la app. Teclearlas aquí haría que mover
// el techo en un lado dejara la medición clasificando con el viejo, y la
// medición es justo lo que uno consulta para decidir si moverlo.
const TECHO = COBERTURA_TECHO;
const PISO  = COBERTURA_PISO;

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-cobertura-de-evidencia.cjs --prod\n');
  process.exit(2);
}

// LA ÚNICA PUERTA A LA RED. GET y nada más.
//
// Un 404 es «no existe» y vuelve `null`; cualquier otro error PARA el guion.
// Devolver `null` y seguir haría que un token vencido saliera como «0% de
// cobertura en las siete obras», que es una respuesta creíble y falsa.
async function leer(ruta) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'GET',
    headers: DESTINO.prod
      ? { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO }
      : { Authorization: 'Bearer owner' },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    console.error(`\nNO ARRANCÓ: HTTP ${r.status} en ${ruta}`);
    console.error((await r.text()).slice(0, 300));
    if (r.status === 401 || r.status === 403) console.error(
      '\nSuele ser el token vencido:\n' +
      '  TOKEN=$(gcloud auth application-default print-access-token)');
    process.exit(2);
  }
  return r.json();
}

// ── El REST de Firestore habla en valores etiquetados; la app habla en JS ──
const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

// Todos los documentos de una colección, paginando. Sin esto una obra con más
// de 300 fotos se mediría con las primeras 300 y el resultado sería una
// cobertura menor a la real, dicha con la misma seguridad.
async function coleccion(ruta) {
  const out = [];
  let token = null;
  do {
    const q = `pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const r = await leer(`${ruta}?${q}`);
    if (!r) break;
    for (const d of (r.documents || [])) out.push({ id: d.name.split('/').pop(), ...campos(d) });
    token = r.nextPageToken || null;
  } while (token);
  return out;
}

// El arreglo `subs` TAL COMO LO TIENE LA APP EN MEMORIA. No es una cuenta: es
// el armado de la carga, y tiene que coincidir con el de la app o el cruce
// foto→partida falla. Dos cosas que no son obvias:
//
//   · las extraordinarias viven en OTRO documento y se mezclan al final;
//   · a los `subs` viejos sin `id` la app les pone `${sec}__${idx}`, y la foto
//     migrada guardó ese id. Si aquí no se hiciera lo mismo, `idDePartida`
//     devolvería el `sec` y ninguna foto encontraría su partida: saldría 0%.
async function subsDeObra(obraId) {
  const d = campos(await leer(`obras/${obraId}/avance/subs`));
  const dExtra = campos(await leer(`obras/${obraId}/avance/extraordinarias`));
  const extras = (Array.isArray(dExtra.data) ? dExtra.data : [])
    .map((s, i) => ({ ...s, extra: true, id: s.id || `EXTRA__${i}` }));
  const base = Array.isArray(d.data) ? d.data : [];
  const necesitaMigrar = base.some(s => !s.id);
  const conId = necesitaMigrar
    ? base.map((s, idx) => ({ ...s, id: s.id || `${s.sec || 'C'}__${idx}` }))
    : base;
  return { subs: [...conId, ...extras], idsDerivados: necesitaMigrar };
}

const MXN = n => '$' + Math.round(n).toLocaleString('es-MX');
const pct = n => n.toFixed(1) + '%';

(async () => {
  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];
  if (!docs.length) { console.log('No hay obras que leer.\n'); process.exit(0); }

  const medidas = [];

  for (const d of docs) {
    const obraId = d.name.split('/').pop();
    const o = campos(d);
    const estado = o.estado || 'activa';

    const { subs, idsDerivados } = await subsDeObra(obraId);
    const cfgEvidencia = campos(await leer(`obras/${obraId}/config/evidencia`));
    const migrada = cfgEvidencia.migrada === true;
    const docsEvidencia = migrada ? await coleccion(`obras/${obraId}/evidencia`) : [];

    const evidencia = evidenciaDeObra({ cfgEvidencia, docsEvidencia, subs });

    // AQUÍ VA LA CUENTA DE LA APP, ENTERA. Lee en condiciones de lectura buena
    // —`evidenciaCargada: true`— porque `leer()` para el guion si Firestore no
    // contesta: si llegamos a esta línea, se leyó.
    const c = coberturaDeEvidencia({ subs, evidencia, evidenciaCargada: true });
    const frase = frasesDeCobertura(c);

    // Las huérfanas: fotos cuyo `partidaId` no corresponde a ninguna partida
    // viva. La cuenta de cobertura no las reporta porque no las necesita —no
    // suman y ya— pero medirlas sí hace falta: una foto huérfana es una que el
    // expediente no puede acreditar, y si son muchas la cobertura es baja por
    // una razón que no es «falta tomar fotos».
    const vigentes = evidencia.filter(e => !e.anulada);
    const idsTodos = new Set(subs.map((s, i) => idDePartida(s, i)));
    const huerfanas = vigentes.filter(f => f.partidaId && !idsTodos.has(f.partidaId)).length;
    const sinClave = vigentes.filter(f => !f.partidaId).length;

    medidas.push({
      cobertura: c.pct, total: c.total, cubierto: c.cubierto,
      medible: c.medible, razon: c.razon, frase,
      hastaTecho: c.hastaTecho, faltanParaTecho: c.faltan,
      partidasConFoto: c.partidasConFoto, fotos: vigentes.length,
      obraId, nombre: (o.nombre || '—'), estado, migrada, idsDerivados,
      // «No hay catálogo» y «hay catálogo sin importes» son dos cosas, y la
      // segunda es peor: la pantalla tiene partidas que enseñar y ninguna
      // forma de ponderarlas. Un solo rótulo para las dos escondería que a esa
      // obra le falta el precio, no el catálogo.
      renglones: subs.length,
      partidas: c.partidas,
      huerfanas, sinClave,
      presupuesto: o.presupuesto || null,
    });
  }

  // ── El cuadro ─────────────────────────────────────────────────────────────
  console.log('clave  obra                                  estado   fotos  partidas  cobertura');
  console.log('─'.repeat(92));
  for (const m of medidas) {
    console.log(
      `${m.obraId.padEnd(6)} ${m.nombre.slice(0, 37).padEnd(38)} ${m.estado.padEnd(8)} ` +
      `${String(m.fotos).padStart(5)}  ${String(m.partidasConFoto + '/' + m.partidas).padStart(8)}  ` +
      `${(m.cobertura === null
          ? (m.renglones ? 'sin importes' : 'sin catálogo')
          : pct(m.cobertura)).padStart(12)}`);
  }

  const vivas = medidas.filter(m => m.estado !== 'archivada');

  console.log('');
  console.log('─'.repeat(92));
  console.log('DETALLE DE LAS OBRAS VIVAS');
  console.log('');
  for (const m of vivas) {
    // La brecha va con su TAMAÑO, no con un «NO CUADRA» a secas. Un peso es el
    // redondeo de los importes y nueve millones es otro número con el mismo
    // nombre; el mismo rótulo para los dos hace que el grande se lea como ruido.
    const brecha = m.presupuesto === null ? null : m.presupuesto - m.total;
    console.log(`  ${m.obraId} · ${m.nombre}`);
    console.log(`         contrato ${MXN(m.total)} en ${m.partidas} partidas` +
                `${brecha !== null && Math.abs(brecha) >= 1
                  ? `  ← \`presupuesto\` dice ${MXN(m.presupuesto)}` +
                    `, ${MXN(Math.abs(brecha))} de diferencia` : ''}`);
    console.log(`         con foto ${MXN(m.cubierto)} en ${m.partidasConFoto} partidas` +
                ` → ${m.cobertura === null ? 'n/d' : pct(m.cobertura)}`);
    // El veredicto es el QUE VA A IMPRIMIR EL EXPEDIENTE, palabra por palabra.
    // Aquí estaba redactado aparte y era otra copia: el guion podía decir «se
    // publica el número» mientras el PDF decía otra cosa, y lo que uno quiere
    // de una medición es poder leer lo que va a salir impreso.
    console.log(`         ${m.frase.titulo}`);
    console.log(`         ${m.frase.detalle}`);
    console.log(`         evidencia ${m.migrada ? 'en subcolección (migrada)' : 'en el arreglo viejo'}` +
                `${m.idsDerivados ? ' · ids de partida DERIVADOS del índice' : ''}`);
    if (m.huerfanas) console.log(`         ${m.huerfanas} foto(s) HUÉRFANAS: su partida ya no existe`);
    if (m.sinClave) console.log(`         ${m.sinClave} foto(s) SIN partida`);
    if (m.cobertura !== null && m.cobertura < TECHO) {
      console.log(`         para el techo del ${TECHO}% hacen falta las ${m.hastaTecho} partidas más grandes;` +
                  ` faltan ${m.faltanParaTecho.length} por fotografiar`);
      for (const x of m.faltanParaTecho.slice(0, 5))
        console.log(`           · ${(x.s.sec || x.id)} ${MXN(x.imp)} — ${(x.s.sub || '').slice(0, 44)}`);
      if (m.faltanParaTecho.length > 5)
        console.log(`           · … y ${m.faltanParaTecho.length - 5} más`);
    }
    console.log('');
  }

  // ── El veredicto que decide si el criterio se puede construir ─────────────
  const conCat = vivas.filter(m => m.cobertura !== null);
  const arriba = conCat.filter(m => m.cobertura >= TECHO);
  const medio  = conCat.filter(m => m.cobertura >= PISO && m.cobertura < TECHO);
  const abajo  = conCat.filter(m => m.cobertura < PISO);

  console.log('─'.repeat(92));
  const sinImportes = vivas.filter(m => m.cobertura === null && m.renglones).length;
  const sinCatalogo = vivas.filter(m => m.cobertura === null && !m.renglones).length;
  console.log(`Obras vivas medibles: ${conCat.length} de ${vivas.length}` +
              `${sinImportes ? ` · ${sinImportes} con catálogo SIN IMPORTES` : ''}` +
              `${sinCatalogo ? ` · ${sinCatalogo} sin catálogo` : ''}`);
  console.log(`  ≥ ${TECHO}%:          ${arriba.length}   ${arriba.map(m => m.obraId).join(' ') || '—'}`);
  console.log(`  ${PISO}%–${TECHO}%:        ${medio.length}   ${medio.map(m => m.obraId).join(' ') || '—'}`);
  console.log(`  < ${PISO}%:          ${abajo.length}   ${abajo.map(m => m.obraId).join(' ') || '—'}`);
  console.log('');
  if (abajo.length === conCat.length) {
    console.log(`TODAS las obras vivas están debajo del ${PISO}%. El expediente va a decir`);
    console.log('«la evidencia no alcanza» SIEMPRE, hoy. El número bonito es el caso raro,');
    console.log('no el normal, y la frase de que no alcanza es la que hay que escribir bien.');
  } else if (arriba.length === conCat.length) {
    console.log(`TODAS las obras vivas pasan el ${TECHO}%. La frase de «no alcanza» sería código`);
    console.log('que nunca corre: hay que sembrar el caso para poder medirlo.');
  } else {
    console.log('MIXTO: las tres conductas tienen obra real que las ejerce. El criterio se');
    console.log('puede construir y verificar contra datos que existen.');
  }
  const huerf = vivas.reduce((t, m) => t + m.huerfanas + m.sinClave, 0);
  if (huerf) {
    console.log('');
    console.log(`Además: ${huerf} foto(s) no se pueden atribuir a una partida viva. Esas no`);
    console.log('cubren nada y el expediente no las puede acreditar.');
  }
  console.log('');
})();
