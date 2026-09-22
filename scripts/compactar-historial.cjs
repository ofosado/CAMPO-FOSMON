#!/usr/bin/env node
// Compacta `obras/{obra}/avance/historial` quitando la descripción (`sub`)
// de los snapshots ya guardados. No toca ningún número.
//
// POR QUÉ EXISTE
// La obra 0114 llegó al 93.8% del límite de 1 MiB de Firestore porque cada
// snapshot semanal replicaba la descripción de las 335 partidas. Ocho copias
// del mismo texto. Con el documento así de lleno, el cierre de la semana 31
// ya no cupo y los siete siguientes se perdieron en silencio.
//
// El código ya dejó de guardar la descripción, pero eso solo aplica a los
// snapshots nuevos. Este script limpia los que ya están.
//
// QUÉ NO HACE
// No borra snapshots, no recalcula, no redondea, no reordena. Quita un campo
// de texto y nada más. Cualquier otra diferencia entre el antes y el después
// aborta la escritura.
//
// USO
//     node scripts/compactar-historial.cjs 0114              ← simulación
//     node scripts/compactar-historial.cjs 0114 --escribir   ← escribe
//
// Sin `--escribir` no toca producción: lee, calcula y reporta.
// Requiere `gcloud auth application-default login` vigente.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROYECTO = 'campo-fosmon';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const LIMITE = 1048576;
const CAMPO_A_QUITAR = 'sub';

const obra = process.argv[2];
const escribir = process.argv.includes('--escribir');

if (!obra || obra.startsWith('--')) {
  console.error('Uso: node scripts/compactar-historial.cjs <obra> [--escribir]');
  process.exit(2);
}

// ── Tamaño según las reglas de Firestore, no bytes de JSON ──────────────────
// https://firebase.google.com/docs/firestore/storage-size
const bytesDe = v => {
  const k = Object.keys(v)[0], x = v[k];
  if (k === 'stringValue') return Buffer.byteLength(x, 'utf8') + 1;
  if (k === 'integerValue' || k === 'doubleValue' || k === 'timestampValue') return 8;
  if (k === 'booleanValue' || k === 'nullValue') return 1;
  if (k === 'bytesValue') return Buffer.from(x, 'base64').length;
  if (k === 'referenceValue') return Buffer.byteLength(x, 'utf8') + 16;
  if (k === 'geoPointValue') return 16;
  if (k === 'arrayValue') return (x.values || []).reduce((t, e) => t + bytesDe(e), 0);
  if (k === 'mapValue') return bytesDeCampos(x.fields || {});
  return 0;
};
const bytesDeCampos = f => Object.keys(f)
  .reduce((t, k) => t + Buffer.byteLength(k, 'utf8') + 1 + bytesDe(f[k]), 0);
const bytesDeNombre = n => n.split('/documents/').pop().split('/')
  .reduce((t, s) => t + Buffer.byteLength(s, 'utf8') + 1, 0) + 16;
const bytesDeDoc = d => bytesDeNombre(d.name) + bytesDeCampos(d.fields || {}) + 32;
const pct = n => (n / LIMITE * 100).toFixed(1) + '%';

// ── Acceso ──────────────────────────────────────────────────────────────────
const token = execSync('gcloud auth application-default print-access-token',
  { encoding: 'utf8' }).trim();
const cabeceras = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'x-goog-user-project': PROYECTO,
};
const RUTA = `obras/${obra}/avance/historial`;

const pedir = async (url, opciones = {}) => {
  const r = await fetch(url, { headers: cabeceras, ...opciones });
  const cuerpo = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(cuerpo.error || cuerpo)}`);
  return cuerpo;
};

// ── Compactación ────────────────────────────────────────────────────────────
// Devuelve una copia del arreglo `semanas` sin el campo, contando lo quitado.
const compactar = semanas => {
  let quitados = 0;
  const nuevas = semanas.map(sem => {
    const campos = { ...sem.mapValue.fields };
    const subs = campos.subs?.arrayValue?.values;
    if (!subs) return sem;
    const limpias = subs.map(s => {
      const f = { ...s.mapValue.fields };
      if (CAMPO_A_QUITAR in f) { delete f[CAMPO_A_QUITAR]; quitados++; }
      return { mapValue: { fields: f } };
    });
    campos.subs = { arrayValue: { values: limpias } };
    return { mapValue: { fields: campos } };
  });
  return { nuevas, quitados };
};

// Compara el antes y el después ignorando el campo que se quitó. Si aparece
// cualquier otra diferencia, es que el script hizo algo que no debía.
const sinElCampo = v => JSON.parse(JSON.stringify(v), function (k, val) {
  return k === CAMPO_A_QUITAR ? undefined : val;
});

(async () => {
  // 1) Leer el documento tal como está en producción.
  const antes = await pedir(`${BASE}/${RUTA}`);
  const semanas = antes.fields?.semanas?.arrayValue?.values;
  if (!semanas) {
    console.error(`${RUTA} no tiene arreglo \`semanas\`. No hay nada que compactar.`);
    process.exit(1);
  }
  const bytesAntes = bytesDeDoc(antes);

  // 2) Copia local del original ANTES de calcular nada. El respaldo de la
  //    madrugada existe, pero restaurar un export completo de Firestore para
  //    recuperar un documento es desproporcionado; esto es el deshacer barato.
  const dirCopias = path.join(os.homedir(), 'campo-backups');
  fs.mkdirSync(dirCopias, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const copia = path.join(dirCopias, `historial-${obra}-antes-${sello}.json`);
  fs.writeFileSync(copia, JSON.stringify(antes, null, 2));

  // 3) Compactar y medir.
  const { nuevas, quitados } = compactar(semanas);
  const despues = { ...antes, fields: { ...antes.fields,
    semanas: { arrayValue: { values: nuevas } } } };
  const bytesDespues = bytesDeDoc(despues);

  console.log(`\n${RUTA}`);
  console.log(`  copia local        ${copia}`);
  console.log(`  snapshots          ${semanas.length}  (${semanas.map(s => s.mapValue.fields.id?.stringValue).join(', ')})`);
  console.log(`  descripciones      ${quitados.toLocaleString('es-MX')} quitadas`);
  console.log(`  tamaño             ${bytesAntes.toLocaleString('es-MX')} B (${pct(bytesAntes)})  →  ${bytesDespues.toLocaleString('es-MX')} B (${pct(bytesDespues)})`);

  // Cuántos cierres NUEVOS caben. No sirve promediar los que ya están: los
  // snapshots viejos de esta obra no guardaron `cant`, `pu` ni `cantEjec`, y
  // los nuevos sí. Medir con el promedio da un número bonito y falso.
  const NUMERICOS = ['cant', 'pu', 'cantEjec'];
  const pesoCierreNuevo = Math.max(...nuevas.map(sem => {
    const f = sem.mapValue.fields;
    const subs = f.subs?.arrayValue?.values || [];
    const faltantes = subs.reduce((t, s) => t +
      NUMERICOS.filter(k => !(k in s.mapValue.fields))
        .reduce((u, k) => u + Buffer.byteLength(k, 'utf8') + 1 + 8, 0), 0);
    return bytesDeCampos(f) + 1 + faltantes;
  }));
  const caben = Math.floor((LIMITE - bytesDespues) / pesoCierreNuevo);
  console.log(`  cierre nuevo        ~${pesoCierreNuevo.toLocaleString('es-MX')} B  →  caben ${caben} más`);
  if (caben < 52) {
    console.log(`  AVISO              el código retiene 52 semanas y aquí solo caben ${caben}.`);
    console.log(`                     Esto da aire, no resuelve el fondo (PENDIENTES #28).`);
  }

  // 4) Verificación previa: nada más puede haber cambiado.
  const igual = JSON.stringify(sinElCampo(antes.fields)) === JSON.stringify(sinElCampo(despues.fields));
  if (!igual) {
    console.error('\nABORTA · el documento compactado difiere en algo más que la descripción.');
    console.error('No se escribió nada. El original está en la copia local.');
    process.exit(1);
  }
  console.log('  verificación       sin la descripción, el antes y el después son idénticos');

  if (quitados === 0) {
    console.log('\nNo hay descripciones que quitar: el documento ya está compactado.');
    return;
  }

  if (!escribir) {
    console.log('\nSIMULACIÓN · no se escribió nada. Para aplicarlo:');
    console.log(`    node scripts/compactar-historial.cjs ${obra} --escribir\n`);
    return;
  }

  // 5) Escribir. `updateMask` acota la escritura al campo `semanas`: si el
  //    documento tuviera otros campos, quedan intactos.
  console.log('\nEscribiendo…');
  await pedir(`${BASE}/${RUTA}?updateMask.fieldPaths=semanas`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { semanas: { arrayValue: { values: nuevas } } } }),
  });

  // 6) Releer y comprobar contra lo que se pretendía dejar. No se da por
  //    bueno el 200 de la escritura: se comprueba lo que quedó guardado.
  const releido = await pedir(`${BASE}/${RUTA}`);
  const semRel = releido.fields?.semanas?.arrayValue?.values || [];
  const problemas = [];
  if (semRel.length !== semanas.length)
    problemas.push(`quedaron ${semRel.length} snapshots de ${semanas.length}`);
  if (JSON.stringify(semRel) !== JSON.stringify(nuevas))
    problemas.push('lo guardado no coincide con lo que se envió');
  const idsAntes = semanas.map(s => s.mapValue.fields.id?.stringValue).join(',');
  const idsRel = semRel.map(s => s.mapValue.fields.id?.stringValue).join(',');
  if (idsAntes !== idsRel) problemas.push(`las semanas cambiaron: ${idsRel}`);

  if (problemas.length) {
    console.error('\nESCRITO PERO CON PROBLEMAS:');
    problemas.forEach(p => console.error('  · ' + p));
    console.error(`\nEl original está en ${copia}. Revisa antes de tocar nada más.`);
    process.exit(1);
  }

  const bytesFinal = bytesDeDoc(releido);
  console.log(`Listo · ${RUTA} quedó en ${bytesFinal.toLocaleString('es-MX')} B (${pct(bytesFinal)}), ` +
    `${semRel.length} snapshots intactos.`);
})().catch(e => {
  console.error('\nFALLÓ:', e.message);
  console.error('No se escribió nada si el error ocurrió antes del PATCH.');
  process.exit(1);
});
