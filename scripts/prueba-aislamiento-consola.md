# Prueba de aislamiento entre organizaciones — desde la consola del navegador

Usa este snippet **después** de desplegar `feature/organizaciones` a producción
para verificar en vivo que un usuario NO puede leer datos de otra organización.

CAMPO usa Firebase modular v10 bundled con Vite, así que **NO expone `firebase`
como global**. Este snippet lee el idToken directamente de IndexedDB
(donde Firebase Auth lo guarda) y hace fetch REST a Firestore/Storage.
Misma técnica que usa la suite de tests contra el emulador.

## Preparación

1. Abre `https://campo-fosmon.netlify.app` en Chrome/Firefox.
2. Inicia sesión con una cuenta real.
3. Abre DevTools → Consola.
4. Copia y pega el snippet completo. La salida imprime resultados por línea.

Debe salir denegado para toda ruta cross-org o cross-obra. Si alguna
sale ⚠ AGUJERO, reporta el path.

## Notas sobre gp_construct y gp_detalle

Hoy (feature/organizaciones etapa 1) el rol `auditor` **puede leer**
`global/gp_construct` y `global/gp_detalle/obras/gp_{XXXX}` sin filtro
por obra asignada. Es un pendiente conocido documentado en
`SECURITY_RULES.md` (sección "Pendientes conocidos", punto 1). El
snippet marca esas rutas como `debeDenegar=false` para evitar falsos
positivos.

## Snippet — auditor con obras asignadas

Ajusta `OBRAS_AJENAS` y `OBRAS_PROPIAS` a la cuenta que estás usando.
Ejemplo abajo pre-configurado para `lgomez@fosmon.com.mx` (obras
0112, 0114, 0126; ajenas 0125, 0127).

```javascript
(async () => {
  // ── 1) Sacar el idToken desde IndexedDB de Firebase Auth ──
  const getFirebaseToken = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => reject(new Error('No se pudo abrir firebaseLocalStorageDb'));
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('firebaseLocalStorage', 'readonly');
      const store = tx.objectStore('firebaseLocalStorage');
      const all = store.getAll();
      all.onsuccess = () => {
        const authEntry = all.result.find(e => e.fbase_key?.startsWith('firebase:authUser:'));
        if (!authEntry) return reject(new Error('No hay usuario logueado en IndexedDB'));
        resolve({
          idToken: authEntry.value.stsTokenManager.accessToken,
          refreshToken: authEntry.value.stsTokenManager.refreshToken,
          email: authEntry.value.email,
          uid: authEntry.value.uid,
          apiKey: authEntry.fbase_key.split(':')[2],
        });
      };
      all.onerror = () => reject(all.error);
    };
  });

  // ── 2) Refrescar el token para asegurar claims recientes ──
  const t = await getFirebaseToken();
  const refreshRes = await fetch(`https://securetoken.googleapis.com/v1/token?key=${t.apiKey}`, {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refreshToken)}`,
  }).then(r => r.json());
  const idToken = refreshRes.id_token;

  const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  console.log('%c══ Claims del token (refrescado) ══', 'color:#4A90E2;font-weight:bold;font-size:14px');
  console.log('email :', payload.email);
  console.log('rol   :', payload.rol);
  console.log('orgId :', payload.orgId);
  console.log('tipo  :', payload.tipo);
  console.log('obras :', payload.obras);

  const PROJECT_ID = 'campo-fosmon';
  const BUCKET     = `${PROJECT_ID}.firebasestorage.app`;
  const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const ST_BASE    = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

  // ── AJUSTA SEGÚN LA CUENTA QUE USES ──
  const OBRAS_AJENAS  = ['0125', '0127'];
  const OBRAS_PROPIAS = ['0112', '0114', '0126'];

  // Cada entrada: [etiqueta, subpath desde obras/{oid}, debeDenegar_cuando_ajena]
  // gp_detalle marcado con false: auditor SÍ lo lee (pendiente conocido en SECURITY_RULES.md).
  const paths = (obraId) => [
    ['doc principal',   `obras/${obraId}`,                                 true],
    ['config/info',     `obras/${obraId}/config/info`,                     true],
    ['nómina',          `obras/${obraId}/nomina/historial`,                true],
    ['otros_gastos',    `obras/${obraId}/config/otros_gastos`,             true],
    ['maquinaria',      `obras/${obraId}/avance/maquinaria`,               true],
    ['subcontratos',    `obras/${obraId}/subcontratos/lista`,              true],
    ['bitácora seed',   `obras/${obraId}/bitacora/entrada_seed`,           true],
    // gp_detalle NO se restringe por obra en las reglas actuales — pendiente #1
    ['gp_detalle',      `global/gp_detalle/obras/gp_${obraId}`,            false],
  ];

  const probarFirestore = async (etiqueta, path, debeDenegar) => {
    const url = `${FS_BASE}/${path}`;
    const res = await fetch(url, {headers: {Authorization: `Bearer ${idToken}`}});
    if (res.status === 200) {
      const emoji = debeDenegar ? '⚠ AGUJERO' : '✓';
      console.log(`${emoji.padEnd(11)} ${etiqueta.padEnd(16)} ${path.padEnd(52)} → EXISTS`);
    } else if (res.status === 404) {
      const emoji = debeDenegar ? '⚠ AGUJERO' : '✓';
      console.log(`${emoji.padEnd(11)} ${etiqueta.padEnd(16)} ${path.padEnd(52)} → not-found`);
    } else if (res.status === 403 || res.status === 401) {
      const emoji = debeDenegar ? '✓' : '⚠ FALSO POSITIVO';
      console.log(`${emoji.padEnd(11)} ${etiqueta.padEnd(16)} ${path.padEnd(52)} → DENIED (${res.status})`);
    } else {
      console.log(`? ${etiqueta.padEnd(16)} ${path.padEnd(52)} → HTTP ${res.status}`);
    }
  };

  // 1) Obras ajenas — TODAS deben DENEGAR excepto gp_detalle (pendiente conocido)
  console.log('%c\n══ Firestore: obras que NO tienes (deben DENEGAR excepto gp_detalle) ══', 'color:#D14B3D;font-weight:bold;font-size:14px');
  for (const oid of OBRAS_AJENAS) {
    console.log(`\n─── obra ${oid} (ajena) ───`);
    for (const [etq, p, debe] of paths(oid)) await probarFirestore(etq, p, debe);
  }

  // 2) Obras propias — TODAS deben PERMITIR lectura
  console.log('%c\n══ Firestore: tus obras (deben PERMITIR) ══', 'color:#2E9E6B;font-weight:bold;font-size:14px');
  for (const oid of OBRAS_PROPIAS) {
    console.log(`\n─── obra ${oid} (propia) ───`);
    for (const [etq, p] of paths(oid)) await probarFirestore(etq, p, false);
  }

  // 3) Globales
  console.log('%c\n══ Firestore: globales ══', 'color:#4A90E2;font-weight:bold;font-size:14px');
  await probarFirestore('gp_construct',    'global/gp_construct',              false);  // auditor sí lee (pendiente #1)
  await probarFirestore('historial_obras', 'global/historial_obras',           true);   // solo directivos
  await probarFirestore('orgs/fosmon',     'orgs/fosmon',                      false);  // su propia org
  await probarFirestore('otro user',       'usuarios/ofosado_fosmon_com_mx',   true);   // no puede leer perfiles ajenos

  // 4) Storage — fotos y nómina
  console.log('%c\n══ Storage: fotos y nómina ══', 'color:#4A90E2;font-weight:bold;font-size:14px');
  const probarStorage = async (etiqueta, prefix, debeDenegar) => {
    const url = `${ST_BASE}?prefix=${encodeURIComponent(prefix)}&maxResults=1`;
    const res = await fetch(url, {headers: {Authorization: `Bearer ${idToken}`}});
    if (res.status === 200) {
      const emoji = debeDenegar ? '⚠ AGUJERO' : '✓';
      console.log(`${emoji.padEnd(11)} ${etiqueta.padEnd(24)} ${prefix.padEnd(40)} → LISTADO permitido`);
    } else if (res.status === 403 || res.status === 401) {
      const emoji = debeDenegar ? '✓' : '⚠ FALSO POSITIVO';
      console.log(`${emoji.padEnd(11)} ${etiqueta.padEnd(24)} ${prefix.padEnd(40)} → DENIED (${res.status})`);
    } else {
      console.log(`? ${etiqueta.padEnd(24)} ${prefix.padEnd(40)} → HTTP ${res.status}`);
    }
  };
  for (const oid of OBRAS_AJENAS) {
    await probarStorage(`obra ${oid} fotos`,  `obras/${oid}/fotos/`,  true);
    await probarStorage(`obra ${oid} nómina`, `obras/${oid}/nomina/`, true);
  }
  for (const oid of OBRAS_PROPIAS) {
    await probarStorage(`obra ${oid} fotos`,  `obras/${oid}/fotos/`,  false);
    await probarStorage(`obra ${oid} nómina`, `obras/${oid}/nomina/`, false);
  }

  console.log('%c\n══ Fin ══', 'color:#4A90E2;font-weight:bold;font-size:14px');
})();
```

## Cómo leer el resultado

- **✓ DENIED** en filas de obras ajenas: correcto.
- **✓ EXISTS** o **✓ not-found** en filas de obras propias: correcto.
- **✓ EXISTS** en `gp_construct` y `gp_detalle`: correcto por ahora (pendiente #1).
- **⚠ AGUJERO** en cualquier fila de obra ajena que no sea gp_detalle: reglas rotas, reportar el path.
- **⚠ FALSO POSITIVO** en obras propias o gp_construct/gp_detalle: reportar (indica que las reglas están más restrictivas de lo esperado).

## Otras cuentas para probar

- **Directivo** (`ofosado@fosmon.com.mx`): `OBRAS_AJENAS=[]`, `OBRAS_PROPIAS` = todas las que existan. Debe leer todo dentro de fosmon.
- **Auditor externo** (`aqcoisa@hytorc.com.mx`, `aromero@hytorc.com.mx`, `j.hdz@noleaks.com.mx`): `OBRAS_PROPIAS=['0127']`, `OBRAS_AJENAS` = las demás.

Si algún claim viene vacío o con formato viejo, cierra sesión y vuelve a entrar
para forzar refresh del JWT.
