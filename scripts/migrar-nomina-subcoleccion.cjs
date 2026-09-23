#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// MIGRACIÓN DE NÓMINA: DEL ARREGLO A LA SUBCOLECCIÓN (PENDIENTES #28)
// ════════════════════════════════════════════════════════════════════════════
//
// Mueve `obras/{id}/nomina/historial.semanas[]` a un documento por semana en
// `obras/{id}/nomina_historial/{Y2026-S38}`, y al final levanta la bandera
// `config/info.formatoHistorial.nomina = 2` para que la app lea de ahí.
//
// POR OMISIÓN NO ESCRIBE NADA. Sin `--escribir` hace el ensayo completo:
// lee, agrupa, valida y enseña exactamente lo que haría. Eso es lo que se
// revisa antes de dejarlo tocar producción.
//
//   node scripts/migrar-nomina-subcoleccion.cjs --obra 0126
//   node scripts/migrar-nomina-subcoleccion.cjs --obra 0126 --escribir
//
// ── El orden importa, y es este ─────────────────────────────────────────────
//
//   1. Leer el historial viejo y agrupar por semana de CALENDARIO.
//   2. Validar TODO antes de escribir nada. Si un solo registro no tiene año
//      confirmado en la tabla, la obra entera se queda como está. Media obra
//      migrada es peor que ninguna: la guarda de lectura gritaría y el
//      operador tendría que deshacer a mano.
//   3. Escribir los documentos de semana.
//   4. VOLVER A LEERLOS y comparar contra el origen, registro por registro.
//   5. Solo si el paso 4 sale limpio, levantar la bandera.
//
// El documento viejo NO se borra. Sigue ahí, intacto, por dos razones: es la
// red si algo sale mal, y es contra él que compara `avisarSiFaltanSemanas` en
// la app. Se vacía en un paso posterior, a mano, cuando la obra lleve tiempo
// leyendo de la subcolección sin incidencias.
//
// ── Por qué la bandera va al final y no al principio ────────────────────────
//
// Entre el paso 3 y el 5 la app sigue leyendo el formato viejo, que está
// completo. Si la migración se interrumpe a la mitad, lo peor que queda es
// una subcolección incompleta que nadie lee todavía. Al revés —bandera
// primero— la ventana de fallo deja a la obra enseñando media nómina.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { idSemana, semanaCorregida, añoDeSemana, AÑOS } =
  require(path.join(__dirname, 'migracion-nomina-anios.cjs'));

const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

// El orden de migración, de menos a más que perder. La 0127 y la 0112 tienen
// dos semanas cada una; la 0114 tiene catorce y es la que ya perdió siete
// cierres en avance por este mismo defecto, así que va al final, cuando el
// camino esté recorrido. Va escrito aquí y no en la cabeza de nadie: el día de
// la migración se corre obra por obra y el orden es la mitad de la seguridad.
const ORDEN = ['0127', '0112', '0126', '0125', '0114'];

const args = process.argv.slice(2);
const ESCRIBIR = args.includes('--escribir');
const iObra = args.indexOf('--obra');
const OBRAS = iObra >= 0 && args[iObra + 1]
  ? [args[iObra + 1]]
  // Ninguna obra de la tabla se queda fuera por no estar en ORDEN: las que no
  // figuren van detrás, no desaparecen.
  : [...new Set([...ORDEN, ...Object.keys(AÑOS)])].filter(o => AÑOS[o]);

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(1); }

// ── Transporte ──────────────────────────────────────────────────────────────
// Ningún fallo se traga. Una migración que sigue después de un error de red
// es una migración que reporta éxito sobre datos a medio mover.
const pedir = (metodo, ruta, cuerpo) => new Promise((res, rej) => {
  const r = https.request({
    host: 'firestore.googleapis.com', path: BASE + ruta, method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P,
               ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
  }, resp => {
    let b = ''; resp.on('data', d => b += d);
    resp.on('end', () => {
      if (resp.statusCode === 200) return res(JSON.parse(b));
      if (resp.statusCode === 404 && metodo === 'GET') return res(null);
      rej(new Error(`${metodo} ${ruta} → ${resp.statusCode}\n${b.slice(0, 400)}` +
        (resp.statusCode === 401 || resp.statusCode === 403
          ? '\nSuele ser el token vencido: `gcloud auth application-default print-access-token > /tmp/adc.tok`'
          : '')));
    });
  });
  r.on('error', rej);
  if (cuerpo) r.write(JSON.stringify(cuerpo));
  r.end();
});

// ── Conversión de tipos ─────────────────────────────────────────────────────
const deValor = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) return deCampos(v.mapValue);
  return null;
};
const deCampos = (d) => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, deValor(v)]));

// `undefined` no existe en Firestore. Se omite la llave, que es lo que hace
// el SDK del navegador: así lo escrito por la migración y lo escrito por la
// app tienen la misma forma y la comparación del paso 4 no da falsos rojos.
const aValor = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter(x => x !== undefined).map(aValor) } };
  if (typeof v === 'object') return { mapValue: { fields: aCampos(v) } };
  throw new Error(`Tipo que no sé escribir: ${typeof v}`);
};
const aCampos = (o) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, aValor(v)]));

// Comparación estructural con llaves ordenadas: el orden de las llaves de un
// mapa no se conserva y no significa nada.
const normalizar = (v) => {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, normalizar(v[k])]));
  return v;
};
const iguales = (a, b) => JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));

const MXN = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');

// ── La semana del NOMBRE DEL ARCHIVO, como segunda opinión ──────────────────
// El campo `semana` lo puso `parsearNomina` rascando las filas de encabezado
// del Excel con una expresión suelta (`src/App.jsx:13110`). No es una fuente
// fiable, y en la 0125 se equivoca. El nombre del archivo, en cambio, lo
// escribió una persona: "…SEM. 22 DEL 21 DE MAY AL 27 DE MAY DE 2026".
//
// Cuando las dos coinciden, el id del documento se apoya en algo. Cuando
// discrepan, la migración PARA: un id de semana equivocado no se ve raro —
// la semana aterriza donde nadie la busca, o encima de otra— y es
// irreversible una vez vaciado el documento viejo.
const semanaDelArchivo = (archivo) => {
  const s = String(archivo || '');
  const m = s.match(/sem\.?\s*(\d{1,2})\b/i) || s.match(/sem(\d{1,2})\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return (n >= 1 && n <= 53) ? n : null;
};

// ── 1 y 2. Leer, agrupar y VALIDAR ──────────────────────────────────────────
const planDe = async (obra) => {
  const viejo = deCampos(await pedir('GET', `/obras/${obra}/nomina/historial`));
  const regs = Array.isArray(viejo.semanas) ? viejo.semanas : [];

  // Todo o nada: se resuelven las claves de TODOS los registros antes de
  // tocar nada. `idSemana` lanza si el año no está confirmado a mano.
  const porClave = new Map();
  const errores = [];
  for (const reg of regs) {
    let clave;
    try { clave = idSemana(obra, reg); }
    catch (e) { errores.push(e.message); continue; }

    // Segunda opinión. Se contrasta contra el número QUE SE VA A USAR —el
    // corregido a mano si lo hay— no contra el campo crudo. Si discrepan, una
    // de las dos fuentes está mal y no hay forma de saber cuál desde aquí: se
    // para. Un registro corregido a mano pasa porque la corrección salió
    // justamente del nombre del archivo, así que coinciden por construcción.
    const delNombre = semanaDelArchivo(reg.archivo);
    const usada = semanaCorregida(obra, reg);
    if (delNombre !== null && delNombre !== usada) {
      errores.push(
        `«${reg.archivo || 'sin archivo'}» dice semana ${delNombre} y se usaría ` +
        `${usada} (el campo \`semana\` dice «${reg.semana}»). Iría a parar a ${clave}. ` +
        `Si el bueno es ${delNombre}, agrégalo a SEMANAS en ` +
        `scripts/migracion-nomina-anios.cjs con su justificación.`);
      continue;
    }

    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(reg);
  }

  // Las partes de una semana se ordenan para que el resultado no dependa del
  // orden en que estuvieran en el arreglo viejo. Se ordena por archivo, que
  // es lo único estable: `fecha` es la de carga y puede repetirse.
  const semanas = [...porClave.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([clave, partes]) => ({
      clave,
      año: añoDeSemana(obra, partes[0]),
      semana: semanaCorregida(obra, partes[0]),
      partes: partes.slice().sort((x, y) =>
        String(x.archivo || '').localeCompare(String(y.archivo || ''))),
    }));

  return { regs, semanas, errores };
};

// ── 4b. ¿Se movió el origen mientras corríamos? ─────────────────────────────
// Entre que se lee el documento viejo y que se levanta la bandera pasan varios
// segundos, y en ese hueco un residente puede guardar una raya desde la app.
// Esa carga entra al documento viejo —que es el que la app todavía usa— y la
// subcolección no la tendría. Al subir la bandera desaparecería de la pantalla,
// y en nómina no hay de dónde recuperarla salvo del Excel, si alguien lo
// guardó.
//
// No basta con contar. Un guardado puede dejar el mismo número de registros
// —editar una carga, o borrar una y agregar otra— así que se compara registro
// por registro con una huella de lo que identifica a cada uno. Y se dice QUÉ
// se movió, no sólo que algo se movió: abortar sin decir qué obliga a
// reconstruirlo a mano desde la consola.
const huella = (r) => JSON.stringify([
  String(r?.archivo ?? ''), String(r?.semana ?? ''), String(r?.fecha ?? ''),
  Number(r?.totalNomina) || 0, (r?.trabajadores || []).length,
]);
const nombrar = (r) => `«${r?.archivo || 'sin archivo'}» (semana «${r?.semana ?? '?'}», ` +
  `${(r?.trabajadores || []).length} trab, ${MXN(r?.totalNomina)})`;

// La comparación va aparte de la lectura para poder probarla sin red: es la
// parte con lógica, y es la que decide si se sube la bandera o no.
const compararOrigen = (antesRegs, regs) => {
  const cuenta = (lista) => {
    const m = new Map();
    for (const r of lista) m.set(huella(r), (m.get(huella(r)) || 0) + 1);
    return m;
  };
  const antes = cuenta(antesRegs), despues = cuenta(regs);
  const nuevos = [], idos = [];
  for (const r of regs) if ((despues.get(huella(r)) || 0) > (antes.get(huella(r)) || 0)) {
    nuevos.push(r); antes.set(huella(r), (antes.get(huella(r)) || 0) + 1);
  }
  for (const r of antesRegs) if ((antes.get(huella(r)) || 0) > (despues.get(huella(r)) || 0)) {
    idos.push(r); despues.set(huella(r), (despues.get(huella(r)) || 0) + 1);
  }

  if (regs.length === antesRegs.length && !nuevos.length && !idos.length) return null;

  const l = [`el documento viejo tenía ${antesRegs.length} registro(s) al empezar y ahora tiene ${regs.length}`];
  for (const r of nuevos) l.push(`  entró:  ${nombrar(r)}`);
  for (const r of idos)  l.push(`  salió:  ${nombrar(r)}`);
  return l.join('\n');
};

const seMovioElOrigen = async (obra, plan) => {
  const ahora = deCampos(await pedir('GET', `/obras/${obra}/nomina/historial`));
  return compararOrigen(plan.regs, Array.isArray(ahora?.semanas) ? ahora.semanas : []);
};

// ── 4. Releer y comparar contra el origen ───────────────────────────────────
const verificar = async (obra, plan) => {
  const fallas = [];
  const leidos = [];
  for (const sem of plan.semanas) {
    const d = deCampos(await pedir('GET', `/obras/${obra}/nomina_historial/${sem.clave}`));
    if (!d || !Array.isArray(d.partes)) {
      fallas.push(`${sem.clave}: no se volvió a leer`);
      continue;
    }
    if (d.partes.length !== sem.partes.length)
      fallas.push(`${sem.clave}: se escribieron ${sem.partes.length} parte(s) y se leen ${d.partes.length}`);
    if (!iguales(d.partes, sem.partes))
      fallas.push(`${sem.clave}: lo que se lee NO es igual a lo que se mandó`);
    if (d.clave !== sem.clave)
      fallas.push(`${sem.clave}: el documento se llama a sí mismo «${d.clave}»`);
    leidos.push(...d.partes);
  }
  // La comprobación de fondo: ni un registro menos que en el origen.
  if (leidos.length !== plan.regs.length)
    fallas.push(`la subcolección tiene ${leidos.length} registro(s) y el documento viejo ${plan.regs.length}`);
  const suma = (a) => a.reduce((t, r) => t + (Number(r.totalNomina) || 0), 0);
  if (Math.round(suma(leidos)) !== Math.round(suma(plan.regs)))
    fallas.push(`el dinero no cuadra: ${MXN(suma(leidos))} en la subcolección contra ${MXN(suma(plan.regs))} en el origen`);
  return fallas;
};

// ── Programa ────────────────────────────────────────────────────────────────
(async () => {
  console.log(ESCRIBIR
    ? '*** MODO ESCRITURA — esto toca PRODUCCIÓN ***\n'
    : 'Ensayo. No se escribe nada. Agrega --escribir cuando esté revisado.\n');

  let problemas = 0;

  for (const obra of OBRAS) {
    console.log('═'.repeat(72));
    console.log(`OBRA ${obra}`);
    console.log('═'.repeat(72));

    const plan = await planDe(obra);

    if (plan.errores.length) {
      console.log(`\n${plan.errores.length} registro(s) sin clave de semana confiable:\n`);
      for (const e of plan.errores) console.log('  ' + e + '\n');
      console.log('La obra NO se migra. Cada registro necesita año Y número de semana');
      console.log('confirmados a mano en scripts/migracion-nomina-anios.cjs, con su');
      console.log('justificación, antes de repetir.');
      problemas++;
      continue;
    }

    const totalPartes = plan.semanas.reduce((t, s) => t + s.partes.length, 0);
    console.log(`\n${plan.regs.length} registro(s) → ${plan.semanas.length} semana(s) de calendario`);
    for (const s of plan.semanas) {
      const dinero = s.partes.reduce((t, p) => t + (Number(p.totalNomina) || 0), 0);
      const trab = s.partes.reduce((t, p) => t + (p.trabajadores || []).length, 0);
      console.log(`  ${s.clave}  ${String(s.partes.length)} parte(s) · ${String(trab).padStart(3)} trab · ${MXN(dinero).padStart(12)}` +
        (s.partes.length > 1 ? `   ← partida en ${s.partes.length} archivos: ${s.partes.map(p => p.archivo || 'sin archivo').join(', ')}` : ''));
    }
    if (totalPartes !== plan.regs.length) {
      console.log(`\nSe perdió algo al agrupar: ${plan.regs.length} registros y ${totalPartes} partes.`);
      problemas++;
      continue;
    }

    if (!ESCRIBIR) {
      console.log('\n(ensayo: no se escribió nada)\n');
      continue;
    }

    // 3. Escribir
    // La forma del documento es EXACTAMENTE la que escribe la app
    // (`escribirHistorialNomina`): `clave`, `partes`, `actualizado`. Nada más.
    // El año y el número de semana no se guardan aunque aquí se conozcan: la
    // `clave` ya los lleva dentro, y un campo que la app no mantiene se
    // desactualiza en el primer guardado sin que nadie lo note.
    console.log('\nEscribiendo…');
    for (const s of plan.semanas) {
      await pedir('PATCH', `/obras/${obra}/nomina_historial/${s.clave}`, {
        fields: aCampos({ clave: s.clave, partes: s.partes,
                          actualizado: new Date().toISOString() }),
      });
      console.log(`  escrita  ${s.clave}`);
    }

    // 4. Releer y comparar
    console.log('\nVerificando contra el origen…');
    const fallas = await verificar(obra, plan);
    if (fallas.length) {
      console.log(`\n${fallas.length} problema(s):`);
      for (const f of fallas) console.log('  ' + f);
      console.log('\nLa bandera NO se levanta. La app sigue leyendo el documento viejo,');
      console.log('que está intacto, así que la obra no ha perdido nada. Revisa y repite.');
      problemas++;
      continue;
    }
    console.log('  todo cuadra: mismas semanas, mismas partes, mismo dinero.');

    // 4b. Última mirada al origen antes del punto de no retorno.
    console.log('\nComprobando que nadie cargó nómina mientras tanto…');
    const movido = await seMovioElOrigen(obra, plan);
    if (movido) {
      console.log('\nEl documento viejo CAMBIÓ durante la migración:\n');
      console.log(movido.split('\n').map(l => '  ' + l).join('\n'));
      console.log('\nLa bandera NO se levanta. La app sigue leyendo el documento viejo,');
      console.log('que tiene esa carga; si subiéramos la bandera ahora, desaparecería de');
      console.log('la pantalla y en nómina no hay de dónde sacarla otra vez.');
      console.log('La subcolección quedó escrita pero nadie la lee: volver a correr esto');
      console.log('cuando no haya nadie capturando la reescribe completa.');
      problemas++;
      continue;
    }
    console.log('  el origen sigue igual que al empezar.');

    // 5. Bandera
    // La máscara es `formatoHistorial.nomina`, ANIDADA, no `formatoHistorial`.
    // Comprobado contra el emulador: con la máscara en el mapa entero, el
    // PATCH lo reemplaza completo y se lleva por delante las otras llaves.
    // Hoy sólo existe `nomina` y no se notaría, pero `formatoHistorial` es un
    // mapa justamente para que `avance` migre por su cuenta más adelante — y
    // si avance migra primero, esta llamada le devolvería la bandera a 1 y la
    // app volvería a leer su documento viejo, que para entonces puede estar
    // vacío. Sin máscara, además, borraría el resto de `config/info`.
    await pedir('PATCH',
      `/obras/${obra}/config/info?updateMask.fieldPaths=formatoHistorial.nomina`,
      { fields: aCampos({ formatoHistorial: { nomina: 2 } }) });
    const info = deCampos(await pedir('GET', `/obras/${obra}/config/info`));
    console.log(`\nBandera: formatoHistorial.nomina = ${info?.formatoHistorial?.nomina}`);
    if (info?.formatoHistorial?.nomina !== 2) {
      console.log('No quedó en 2. La app sigue leyendo el formato viejo.');
      problemas++;
      continue;
    }
    console.log('La obra lee ya de la subcolección. El documento viejo se queda');
    console.log('como estaba: es la red y es contra lo que compara la guarda.\n');
  }

  console.log('═'.repeat(72));
  if (problemas) {
    console.log(`${problemas} obra(s) con problemas. Ninguna de ellas quedó a medias:`);
    console.log('la bandera solo se levanta después de verificar.');
    process.exit(1);
  }
  console.log(ESCRIBIR
    ? 'Migración terminada. Siguiente paso, cuando lleve días sin incidencias:\n' +
      'vaciar `nomina/historial` a mano, que es lo que calla a la guarda.'
    : 'Ensayo limpio. Con --escribir hace lo de arriba de verdad.');
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
