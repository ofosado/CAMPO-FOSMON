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

const HOST = '127.0.0.1';
const PUERTO_FS = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon';
const LLAVE = 'fake-api-key';

// Las contraseñas son de mentira y viven aquí, en el guion, a propósito: son
// parte de la semilla y no de la memoria de nadie. El emulador se borra al
// apagarlo.
const CLAVE = 'demo1234';

const CUENTAS = [
  { correo: 'demo@fosmon.com.mx', nombre: 'Demo FOSMON',
    rol: 'director_general', tipo: 'constructora', orgId: 'fosmon' },
  { correo: 'oscar@cotea.com.mx', nombre: 'Oscar Fosado',
    rol: 'director_obras', tipo: 'dependencia', orgId: 'coatzacoalcos' },
];

const idDeCorreo = c => c.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

// ── Auth del emulador, por REST ─────────────────────────────────────────────
const authURL = ruta => `http://${HOST}:${PUERTO_AUTH}/identitytoolkit.googleapis.com/v1/${ruta}`;

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
    return j2.localId;
  }
  if (!j.localId) throw new Error(`no se pudo crear ${correo}: ${JSON.stringify(j.error)}`);
  return j.localId;
}

// Los claims son el dato con el que las reglas juzgan la petición Y con el que
// la interfaz decide el tipo (P5). Si se sembraran sólo en el perfil, el front
// entraría y elegiría mal la ruta: es justo el modo de fallo del #31 y el #35.
async function ponerClaims(localId, claims) {
  const r = await fetch(`http://${HOST}:${PUERTO_AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROYECTO}/accounts:update`, {
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

// La forma del snapshot NO se inventa aquí: es la que escribe
// `crearSnapshotAvance` en App.jsx, campo por campo. En la primera versión de
// este guion la fecha se llamaba `fecha` y el resultado fue que las tres obras
// salían "Sin captura registrada" con el historial lleno — la app lee
// `fechaCaptura`. Un sembrador con el esquema casi-bien es peor que no tener
// sembrador: la pantalla miente y la mentira parece un defecto del producto.
const semanasDe = (filas, contratado, cuantas) => {
  const hoy = new Date();
  const out = [];
  for (let k = cuantas; k >= 1; k--) {
    const f = new Date(hoy.getTime() - k * 7 * 86400000);
    const factor = (cuantas - k + 1) / cuantas;
    const subs = filas.map(s => ({ sec: s.sec, a: Math.round(s.a * factor),
      imp: s.imp, cant: s.cant, pu: s.pu, cantEjec: Math.round(s.cantEjec * factor) }));
    const semana = Math.ceil(((f - new Date(f.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
    const ejecutado = subs.reduce((t, s) => t + (s.cantEjec * s.pu), 0);
    out.push({ id: `S${semana}-${f.getFullYear()}`, semana, año: f.getFullYear(),
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

async function sembrarObra(prefijo, id, obra, opciones = {}) {
  const filas = partidas(obra.semilla, obra.nPartidas, obra.contratado);
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
    ...(opciones.gpId ? { gpId: opciones.gpId } : {}),
  });
  await escribir(`${prefijo}obras/${id}/avance/subs`, {
    data: filas, fecha: new Date(Date.now() - (obra.diasSinCaptura ?? 2) * 86400000).toISOString(),
    por: 'siembra@local',
  });
  await escribir(`${prefijo}obras/${id}/avance/historial`, {
    semanas: semanasDe(filas, obra.contratado, obra.semanas ?? 3),
  });
  await escribir(`${prefijo}obras/${id}/config/estimaciones`, {
    data: obra.estimaciones || [],
  });

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
    await escribir(`${prefijo}obras/${id}/nomina/historial`, {
      semanas: [{ id: 'S38-2026', semana: 38, año: 2026, totalNomina: 486000,
                  totalHEImp: 41000, totalHE: 41000, nPersonas: 34 }],
    });
  }
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
    await ponerClaims(uid, { rol: c.rol, orgId: c.orgId, tipo: c.tipo, todas: true, obras: [] });
    await escribir(`usuarios/${idDeCorreo(c.correo)}`, {
      nombre: c.nombre, correo: c.correo, rol: c.rol, activo: true,
      orgId: c.orgId, obras_asignadas: [], bienvenidaVista: true, uid,
    });
    console.log(`  ${c.correo}  ${c.rol}  tipo=${c.tipo}  org=${c.orgId}`);
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
    estimaciones: EST_C, semanas: 4, diasSinCaptura: 2,
  }, { conEconomia: true, gpId: '0114' });
  await sembrarObra('', '0121', {
    nombre: 'SIOP Coatza Rehab. Av. Universidad', contrato: 'SIOP-2026-0121', contratado: 24800000,
    cliente: 'SIOP Veracruz', ubicacion: 'Coatzacoalcos, Ver.',
    inicio: '2026-05-01', fin: '2026-11-30', semilla: 29, nPartidas: 11,
    estimaciones: EST_C.slice(0, 2), semanas: 3, diasSinCaptura: 12,
  }, { conEconomia: true, gpId: '0121' });

  // El Sheet de GP: es lo que alimenta el chip y el margen del lado
  // constructora. Sin esto el tablero de FOSMON saldría sin gasto y no se
  // podría comprobar que quedó igual.
  await escribir('global/gp_construct', {
    parserVersion: 3,
    ultimaActualizacion: new Date(Date.now() - 3 * 3600000).toISOString(),
    obras: {
      '0114': { id: '0114', nombre: 'Oaxaca Parque Lineal', grandTotal: 21400000 },
      '0121': { id: '0121', nombre: 'SIOP Coatza Rehab. Av. Universidad', grandTotal: 19900000 },
    },
  });
  console.log('obras de constructora: 0114, 0121 (en la raíz) + global/gp_construct');

  // ── Obras de la dependencia, BAJO SU ORGANIZACIÓN ─────────────────────────
  // Tres obras: una sana, una atrasada y una recién arrancada sin estimaciones
  // —para ver que "Pagado $0" se distingue de "no disponible"—.
  const P = 'orgs/coatzacoalcos/';
  await sembrarObra(P, 'OP-2026-001', {
    nombre: 'OBRA DEMO 1 — Rehabilitación de pavimento', contrato: 'MC-OP-2026-001',
    contratado: 12400000, cliente: 'H. Ayuntamiento de Coatzacoalcos',
    ubicacion: 'Col. Centro, Coatzacoalcos, Ver.',
    inicio: '2026-04-01', fin: '2026-11-30', semilla: 7, nPartidas: 12,
    estimaciones: [
      { num: 1, monto: 2800000, estatus: 'pagada',    fecha: '2026-06-20' },
      { num: 2, monto: 3100000, estatus: 'pagada',    fecha: '2026-07-25' },
      { num: 3, monto: 2400000, estatus: 'facturada', fecha: '2026-09-05' },
    ],
    semanas: 4, diasSinCaptura: 3,
  });
  await sembrarObra(P, 'OP-2026-002', {
    nombre: 'OBRA DEMO 2 — Drenaje sanitario', contrato: 'MC-OP-2026-002',
    contratado: 8900000, cliente: 'H. Ayuntamiento de Coatzacoalcos',
    ubicacion: 'Col. Benito Juárez, Coatzacoalcos, Ver.',
    inicio: '2026-06-15', fin: '2026-10-30', semilla: 43, nPartidas: 9,
    estimaciones: [{ num: 1, monto: 1900000, estatus: 'pagada', fecha: '2026-08-12' }],
    // Sin captura en 19 días: dispara la alerta que SÍ le sirve a una
    // dependencia, y así se ve que el recorte no la dejó ciega.
    semanas: 2, diasSinCaptura: 19,
  });
  await sembrarObra(P, 'OP-2026-003', {
    nombre: 'OBRA DEMO 3 — Alumbrado público', contrato: 'MC-OP-2026-003',
    contratado: 5600000, cliente: 'H. Ayuntamiento de Coatzacoalcos',
    ubicacion: 'Av. Universidad, Coatzacoalcos, Ver.',
    inicio: '2026-09-01', fin: '2027-02-28', semilla: 61, nPartidas: 7,
    estimaciones: [], semanas: 1, diasSinCaptura: 4,
  });
  console.log('obras de dependencia: OP-2026-001/002/003 (bajo orgs/coatzacoalcos)');

  console.log('\nEntra con cualquiera de las dos, misma contraseña:');
  for (const c of CUENTAS) console.log(`  ${c.correo.padEnd(24)} ${CLAVE}   (${c.tipo})`);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
