#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL AÑO DE CADA SEMANA DE NÓMINA QUE HAY HOY EN PRODUCCIÓN — A MANO
// ════════════════════════════════════════════════════════════════════════════
//
// Un registro de nómina NO guarda el año. Trae `semana` como texto ("Semana
// 04") y `fecha`, que es el día en que se SUBIÓ el archivo, no la semana que
// se rayó. La app deduce el año con una heurística (`añoSemanaNomina`): elige
// el que deja la semana más cerca de la semana ISO de la carga.
//
// Para PINTAR la pantalla, deducir está bien: si se equivoca, se ve raro y se
// corrige. Para MIGRAR, no. En la subcolección el año es parte del id del
// documento (`Y2026-S04`), y un id equivocado no se ve raro: la semana
// aterriza en un año donde nadie la busca —o peor, encima de otra— y se da
// por perdida. Por eso aquí el año va escrito, no calculado.
//
// ── Por qué no basta la heurística ──────────────────────────────────────────
//
// Acierta en los 33 registros que hay hoy, pero por poco. El caso más
// apretado es la semana 19 de la 0125 —la que el campo guardaba como
// "Semana 30"—:
//
//   subida el 19/6/2026, que es la semana ISO 25 → d = 25 - 19 = 6
//   el umbral es 26, así que quedan VEINTE SEMANAS de margen.
//
// Si esa misma carga masiva se hubiera hecho cinco meses tarde, d habría
// pasado de 26, la heurística habría dicho **2027**, y la semana 19 de 2026
// se habría archivado como `Y2027-S19`: un año en el futuro, invisible en el
// tablero para siempre. El retraso en subir el Excel separa el acierto del
// error.
//
// CORRECCIÓN (2026-09-22): antes aquí se leía que el caso apretado era la
// "semana 04" con CINCO semanas de margen. Ese 04 nunca fue una semana: era
// el número mal raspado de la SEM. 24, y el margen estrecho era un artefacto
// del mismo defecto. Con los números corregidos el más apretado es el de
// arriba. Se deja la nota porque la conclusión —escribir el año en vez de
// calcularlo— es la misma, pero el ejemplo que la sostenía era falso.
//
// Esa es la razón de esta tabla. No es desconfianza del algoritmo de hoy: es
// que el dato de entrada —cuándo se le ocurrió a alguien subir el Excel— no
// tiene nada que ver con el dato que se quiere saber.
//
// ── De dónde salió el año ───────────────────────────────────────────────────
//
// 1. Las SIETE semanas de la 0125 cargadas el 19/6/2026 (semanas 4, 7, 11,
//    14, 21 ×2 y 30) y las DOS del 6/7/2026 (18 y 25): **2026, todas**,
//    confirmado por Omar el 2026-09-22. La obra 0125 (TAMSA Veracruz) no
//    tiene nómina anterior a 2026, así que no hay ambigüedad posible.
// 2. Todo lo demás se subió dentro de la misma semana que se rayó o muy poco
//    después —la separación máxima es de nueve semanas, en la 0114— y no hay
//    ningún cruce de fin de año en el historial. Todas las obras arrancaron
//    en 2026.
// 3. Ningún registro trae `fechaISO`, así que la fecha de carga en d/m/aaaa
//    es la única señal disponible. Comprobado contra producción.
//
// ── Cómo se usa ─────────────────────────────────────────────────────────────
//
//   const { añoDeSemana } = require('./migracion-nomina-anios.cjs');
//   const año = añoDeSemana('0125', reg);   // lanza si no está en la tabla
//
// LANZA A PROPÓSITO cuando el registro no está: una semana que apareció
// después de escribir esto es una semana cuyo año nadie confirmó, y la
// migración tiene que parar y preguntar, no adivinar (P2). Si al correr la
// migración salta esa excepción, lo correcto es añadir la fila aquí con su
// justificación, no quitar la comprobación.
//
// Verificar que la tabla sigue cuadrando con producción:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/migracion-nomina-anios.cjs --verificar

'use strict';

// obra → { número de semana: año }. Una entrada por semana de CALENDARIO; la
// semana que llegó en dos archivos (0126 S38) tiene una sola entrada, que es
// justamente lo que las vuelve la misma semana.
//
// ── OJO CON LA 0125 (2026-09-22) ────────────────────────────────────────────
// El campo `semana` de la 0125 NO trae números de semana. El archivo dice
// "SEM. 19 DEL 30 DE ABR…" y producción guarda "Semana 30". Los nueve están
// mal; los números buenos viven en `SEMANAS`, más abajo.
//
// Lo que está COMPROBADO sobre la causa:
//   · El único código que escribe ese campo es el raspado de `parsearNomina`
//     (`src/App.jsx:13106-13115`).
//   · Pasó por la expresión de RESPALDO, `/s\.?\s*(\d{2})/i`. Se sabe por los
//     ceros a la izquierda: producción guarda "Semana 07" y "Semana 04", y
//     solo esa rama captura dos dígitos fijos. La principal
//     —`/semana\s*(\d+)/i`— ni siquiera casa con "SEM. 20".
//   · Ese respaldo casa con CUALQUIER palabra terminada en "s" seguida de dos
//     dígitos: "SERVICIOS 30", "DIAS 21", "LOS 04". No pide que digan semana.
//   · El bucle que lo aplica no corta, así que gana la ÚLTIMA fila que empate.
//
// Lo que NO se pudo comprobar: qué celda exacta produjo cada número. Sin los
// Excel originales no se reconstruye, y ninguna reconstrucción que se probó
// da los valores de producción. Ocho de los nueve coinciden con el día del
// mes en que arranca el periodo, pero el noveno (SEM. 23, que empieza el 28,
// guardó 21) no encaja, así que ni eso es una regla — es una coincidencia
// parcial, y se anota como tal en vez de venderla como explicación.
//
// Que no se pueda reproducir es parte del argumento: si nadie puede decir de
// dónde salió el número, el parser no tiene por qué estar inventándolo. Va en
// su propia rama y antes de la migración, porque cada carga nueva de TAMSA
// vuelve a guardar un número que nadie sabe de dónde viene.
//
// Confirmar el AÑO no bastó: el año y el número salen de la misma fuente y
// solo se verificó el primero.
const AÑOS = {
  // Malecón. Dos cargas, cada una en su propia semana.
  '0112': { 36: 2026, 37: 2026 },

  // SIOP Parque Lineal / Baumar. Catorce cargas entre mayo y septiembre de
  // 2026, varias fuera de orden (la 23 se subió después de la 31), pero todas
  // del mismo año.
  '0114': {
    22: 2026, 23: 2026, 24: 2026, 25: 2026, 26: 2026, 27: 2026, 28: 2026,
    29: 2026, 30: 2026, 31: 2026, 32: 2026, 33: 2026, 36: 2026, 37: 2026,
  },

  // TAMSA Veracruz. Once cargas: las nueve de la carga masiva (SEM. 19 a 27,
  // mayo–junio) más las dos normales de septiembre. Los números son los
  // CORREGIDOS de `SEMANAS`, no los del campo `semana`.
  '0125': {
    19: 2026, 20: 2026, 21: 2026, 22: 2026, 23: 2026, 24: 2026,
    25: 2026, 26: 2026, 27: 2026, 36: 2026, 37: 2026,
  },

  // Cangrejera. La semana 38 vino en DOS archivos el mismo día (99 y 35
  // trabajadores, gente distinta): un solo cierre partido en dos, no dos
  // semanas.
  '0126': { 36: 2026, 37: 2026, 38: 2026 },

  // Centro de Convenciones.
  '0127': { 36: 2026, 37: 2026 },
};

// ── SEMANAS CORREGIDAS A MANO ───────────────────────────────────────────────
// Igual que la tabla de años, y por la misma razón: el dato de producción no
// es de fiar y nadie lo va a adivinar mejor después. Se indexa por NOMBRE DE
// ARCHIVO, no por el campo `semana`, porque el campo tiene colisiones —dos
// registros distintos dicen "Semana 21"— y el nombre del archivo es único.
//
// De dónde sale cada número: del propio nombre del archivo, que lo escribió
// una persona y trae además el periodo completo. Se comprobó que el número
// declarado es coherente con el calendario: TAMSA cierra JUEVES a MIÉRCOLES,
// y en los nueve casos el número que dice el archivo es la semana ISO del día
// de CIERRE. No es una convención propia que haya que traducir: numerar por
// el cierre da exactamente la semana ISO.
//
//   archivo dice   periodo                  ISO del cierre   campo guardaba
//   SEM. 19        30 abr (jue) – 06 may     19               "Semana 30"
//   SEM. 20        07 may – 13 may           20               "Semana 07"
//   SEM. 21        14 may – 20 may           21               "Semana 14"
//   SEM. 22        21 may – 27 may           22               "Semana 21"
//   SEM. 23        28 may – 03 jun           23               "Semana 21"  ←
//   SEM. 24        04 jun – 10 jun           24               "Semana 04"
//   SEM. 25        11 jun – 17 jun           25               "Semana 11"
//   SEM. 26        18 jun – 24 jun           26               "Semana 18"
//   SEM. 27        25 jun – 01 jul           27               "Semana 25"
//
// La flecha marca la colisión: SEM. 22 y SEM. 23 son semanas distintas y el
// campo mandaba a las dos al mismo documento.
//
// Las dos de septiembre no llevan corrección: sus archivos son
// `…_SEM36.xlsx` / `…_SEM37.xlsx` y el campo coincide, así que pasan solas.
const SEMANAS = {
  '0125': {
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 19 DEL 30 DE ABR AL 06 DE MAY DE 2026.xlsx': 19,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 20 DEL 07 DE MAY AL 13 DE MAY DE 2026.xlsx': 20,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 21 DEL 14 DE MAY AL 20 DE MAY DE 2026.xlsx': 21,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 22 DEL 21 DE MAY AL 27 DE MAY DE 2026.xlsx': 22,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 23 DEL 28 DE MAY AL 03 DE JUN DE 2026.xlsx': 23,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 24 DEL 04 DE JUN AL 10 DE JUN DE 2026.xlsx': 24,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 25 DEL 11 DE JUN AL 17 DE JUN DE 2026.xlsx': 25,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 26 DEL 18 DE JUN AL 24 DE JUN DE 2026.xlsx': 26,
    '0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 27 DEL 25 DE JUN AL 01 DE JUL DE 2026 rev2.xlsx': 27,
  },
};

// El número de semana tal como lo guardó la app: el primer entero de `semana`
// ("Semana 04" → 4), validado contra el rango ISO. Es el dato CRUDO — en la
// 0125 miente. Sirve para contrastarlo, no para construir ids.
const numeroDeSemana = (reg) => {
  const m = String(reg?.semana ?? '').match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : NaN;
  return (n >= 1 && n <= 53) ? n : null;
};

// El número que se usa de verdad: la corrección a mano si la hay, y si no el
// campo. Todo id de documento se construye con este.
const semanaCorregida = (obraId, reg) => {
  const fija = SEMANAS[obraId]?.[String(reg?.archivo ?? '')];
  return fija !== undefined ? fija : numeroDeSemana(reg);
};

const añoDeSemana = (obraId, reg) => {
  const n = semanaCorregida(obraId, reg);
  if (n === null)
    throw new Error(
      `Registro de nómina sin número de semana legible en la obra ${obraId}: ` +
      `semana=${JSON.stringify(reg?.semana)}, archivo=${JSON.stringify(reg?.archivo)}. ` +
      `Sin número no hay id de documento. Revisar a mano.`);
  const año = AÑOS[obraId]?.[n];
  if (!año)
    throw new Error(
      `No hay año confirmado para la semana ${n} de la obra ${obraId} ` +
      `(archivo=${JSON.stringify(reg?.archivo)}, cargado el ${reg?.fecha}). ` +
      `Esta semana apareció después de fijar la tabla: confirmar de qué año es ` +
      `y agregarla a AÑOS en scripts/migracion-nomina-anios.cjs. NO deducirla.`);
  return año;
};

// El id del documento en la subcolección. Año de cuatro cifras y semana con
// cero a la izquierda, para que ordenar por nombre sea ordenar por calendario.
const idSemana = (obraId, reg) =>
  `Y${añoDeSemana(obraId, reg)}-S${String(semanaCorregida(obraId, reg)).padStart(2, '0')}`;

module.exports = { AÑOS, SEMANAS, añoDeSemana, numeroDeSemana, semanaCorregida, idSemana };

// ── Verificación contra producción ──────────────────────────────────────────
if (require.main === module) {
  const total = Object.values(AÑOS).reduce((t, o) => t + Object.keys(o).length, 0);
  console.log(`Tabla: ${Object.keys(AÑOS).length} obras, ${total} semanas de calendario.`);
  for (const [obra, sems] of Object.entries(AÑOS)) {
    const ns = Object.keys(sems).map(Number).sort((a, b) => a - b);
    console.log(`  ${obra}  ${ns.length.toString().padStart(2)} semanas · ` +
      `${[...new Set(Object.values(sems))].join(', ')} · S${ns.join(', S')}`);
  }

  if (!process.argv.includes('--verificar')) {
    console.log('\nCorre con --verificar para contrastarla contra producción.');
    process.exit(0);
  }

  const fs = require('fs');
  const https = require('https');
  const path = require('path');
  const raiz = path.resolve(__dirname, '..');
  const P = 'campo-fosmon';
  const BASE = `/v1/projects/${P}/databases/(default)/documents`;
  let TOKEN;
  try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
  catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(1); }

  const get = (ruta) => new Promise((res, rej) => {
    https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => r.statusCode === 200 ? res(JSON.parse(b)) : res(null));
    }).on('error', rej);
  });
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
  const campos = d => Object.fromEntries(Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

  // Se compara contra la heurística de la app a propósito: no para copiarla,
  // sino para que cualquier discrepancia salga a la luz. Hoy tienen que
  // coincidir en los 33 registros; si algún día dejan de coincidir, manda la
  // tabla y el aviso dice dónde mirar.
  const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
  const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
  const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const decl = {};
  traverse(ast, { VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  }});
  const nombres = ['semanaISO', 'numSemanaNomina', 'fechaCargaNomina', 'añoSemanaNomina'];
  const app = new Function(`"use strict";
    ${nombres.map(n => `const ${n} = ${decl[n]};`).join('\n')}
    return { ${nombres.join(', ')} };`)();

  (async () => {
    let problemas = 0, registros = 0;
    const sobran = new Map(Object.entries(AÑOS).map(([o, s]) => [o, new Set(Object.keys(s).map(Number))]));
    console.log('\nContraste contra producción:\n');
    for (const obra of Object.keys(AÑOS)) {
      const h = campos(await get(`/obras/${obra}/nomina/historial`));
      const regs = h.semanas || [];
      for (const reg of regs) {
        registros++;
        let id;
        try { id = idSemana(obra, reg); }
        catch (e) { console.log(`  FALTA  ${obra}  ${e.message}`); problemas++; continue; }
        sobran.get(obra).delete(semanaCorregida(obra, reg));

        // La app deduce el año a partir del campo CRUDO, que es lo único que
        // tiene. Donde hay corrección a mano, la app está trabajando con un
        // número falso y la comparación no significa nada: se avisa de la
        // divergencia en vez de contarla como problema.
        const cruda = numeroDeSemana(reg), buena = semanaCorregida(obra, reg);
        if (cruda !== buena) {
          console.log(`  CORREGIDA  ${obra}  «${reg.semana}» → semana ${buena} ` +
            `(${reg.archivo}). La app sigue enseñándola como ${cruda}: eso lo ` +
            `arregla el fix de parsearNomina, no esta tabla.`);
          continue;
        }

        const deducido = app.añoSemanaNomina(reg);
        if (deducido !== añoDeSemana(obra, reg)) {
          console.log(`  OJO    ${obra}  ${reg.semana}: la tabla dice ${añoDeSemana(obra, reg)}, ` +
            `la heurística deduce ${deducido}. Manda la tabla, pero confírmalo.`);
          problemas++;
        }
      }
    }
    for (const [obra, ns] of sobran)
      for (const n of ns) {
        console.log(`  SOBRA  ${obra}  semana ${n} está en la tabla pero no en producción ` +
          `(¿se borró la carga? no estorba, pero conviene saberlo)`);
      }
    console.log(`\n${registros} registros revisados · ${problemas} problema(s).`);
    console.log(problemas === 0
      ? 'La tabla cubre todo lo que hay, y coincide con la heurística.'
      : 'Revisar lo de arriba ANTES de migrar.');
    process.exit(problemas > 0 ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}
