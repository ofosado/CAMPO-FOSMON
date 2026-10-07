#!/usr/bin/env node
// Prueba: UNA DEPENDENCIA PUEDE DAR DE ALTA UNA OBRA DESDE LA APP, con los
// campos de su contrato, y el alta no se pierde ni se funde con otra.
//
// Por qué existe. Hasta hoy el alta de obra era de constructora y nada más, y
// no por un permiso de menos: eran cuatro cosas a la vez, y arreglar una sola
// deja la pantalla igual de inservible.
//
//   · EL BOTÓN NO EXISTÍA. `puedeGestionar` nombraba a `director_operaciones` y
//     `gerente_construccion`, los dos de constructora. Ningún rol de dependencia
//     veía «+ Nueva obra».
//
//   · LA ÚNICA PUERTA DEL MODAL ERA EL CATÁLOGO DE GP. `ModalNuevaObra` abría en
//     `paso="seleccionar"` y la única salida de ahí era `seleccionarGP`, de donde
//     salía el `id`. GP es el Sheet de contabilidad de FOSMON: un municipio no
//     tiene una sola fila ahí, así que el formulario era inalcanzable.
//
//   · EL FORMULARIO PEDÍA LOS CAMPOS DEL OTRO. `CAMPOS_CONTRATO.dependencia` ya
//     existía —modalidad de adjudicación, empresa ejecutante, origen de los
//     recursos— y el modal no lo consultaba: tenía la lista de constructora
//     escrita a mano, con `residente` y `admin`, que de ese lado no existen. Y
//     `valid` exigía `cliente`: el botón no se habría habilitado NUNCA.
//
//   · Y EL AVISO NO LLEGABA A NADIE. `notifARoles(['director_general',
//     'director_operaciones','admin_sistema'])` son tres roles de constructora.
//
// Lo que esta prueba vigila de verdad es la quinta, que es la peligrosa:
//
//   · EL ALTA NO PODÍA FALLAR. `agregarObra` metía la obra en la lista ANTES de
//     escribir y cerraba el modal sin mirar el resultado. `fsSet` devuelve
//     `false` cuando las reglas deniegan, y nadie lo leía: la obra aparecía en
//     pantalla con su monto hasta que alguien recargara. Y un `id` repetido no
//     daba error — `fsSet` escribe con `merge`, así que la obra nueva se FUNDÍA
//     con la vieja campo por campo: mitad de un contrato y mitad del otro, sin
//     un solo aviso. Es el #31 con otra cara.
//
// Nada de lo que se afirma aquí es que un símbolo exista (P3): se ejecuta
// `agregarObra` extraída del archivo contra un Firestore de mentiras y se mira
// QUÉ ESCRIBIÓ, a quién avisó y qué devolvió.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta un archivo por argumento para poder correrse contra una copia mutilada
// de App.jsx. Cada mutación rompe SEMÁNTICA —no andamiaje— y se verificó que
// saca rojo (salida 1) y no NO ARRANCÓ (salida 2). Los conteos están al pie.
//
// Uso:  node scripts/prueba-alta-de-obra.cjs [archivo]

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const archivoReglas = process.env.ARCH_REGLAS || path.join(raiz, 'firestore.rules');
noArranco.vigilarExcepciones(archivo);
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  FunctionDeclaration(p) { if (p.node.id) decl[p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
});

// `agregarObra` y `entrar` no son declaraciones de módulo: viven dentro de
// `PantallaObras` y de `App`. Se buscan por DÓNDE viven y no confiando en que
// el nombre sea único en 22 000 renglones — hoy lo es, y es exactamente el tipo
// de cosa que deja de ser verdad sin que nadie lo note.
const dentroDe = (componente, nombre) => {
  let hallado = null;
  traverse(ast, {
    FunctionDeclaration(p) {
      if (!p.node.id || p.node.id.name !== componente) return;
      p.traverse({
        VariableDeclarator(q) {
          if (q.node.id.name === nombre && q.node.init)
            hallado ||= src.slice(q.node.init.start, q.node.init.end);
        },
      });
    },
  });
  return hallado;
};
const agregarObraSrc = dentroDe('PantallaObras', 'agregarObra');
const entrarSrc = dentroDe('App', 'entrar');
const navTabSrc = dentroDe('App', 'navTab');
// La lista de campos del formulario se saca de DENTRO del modal por la misma
// razón, y hay una medida detrás: la primera versión de esta prueba reescribía
// la expresión a mano con el comentario «la misma expresión que arma el modal».
// Puesto `const campos=CAMPOS_ALTA_C` en App.jsx —el defecto original, que le
// pide al municipio su propio nombre y nada de su contrato— la prueba seguía en
// VERDE: comprobaba su propia copia. Esto es lo que significa que la prueba
// ejecute el código y no lo describa.
const camposModalSrc = dentroDe('ModalNuevaObra', 'campos');
const depModalSrc = dentroDe('ModalNuevaObra', 'dep');

const NECESARIOS = [
  'esDependencia', 'ROLES_ALTA_OBRA_C', 'ROLES_EDITAN_CONTRATO_D', 'puedeAltaObra',
  'CAMPOS_CONTRATO', 'camposContrato', 'CAMPOS_ALTA_C', 'OBLIGATORIOS_ALTA',
  'MODALIDADES_ADJUDICACION', 'nuevoIdObra', 'ROLES_AVISO_OBRA_NUEVA',
  'ModalNuevaObra', 'MXN',
  'DESTINOS_DEPENDENCIA', 'destinoNav', 'TABS_DEPENDENCIA', 'TABS_POR_ROL',
  'tabsDe', 'LEXICO', 'SUBTABS_PLANEACION_DEPENDENCIA', 'SUBTABS_OPERACION_DEPENDENCIA',
];
const faltan = NECESARIOS.filter(n => !decl[n]);
if (!agregarObraSrc) faltan.push('`agregarObra` dentro de PantallaObras');
if (!entrarSrc) faltan.push('`entrar` dentro de App');
if (!navTabSrc) faltan.push('`navTab` dentro de App');
if (!camposModalSrc) faltan.push('`campos` dentro de ModalNuevaObra');
if (!depModalSrc) faltan.push('`dep` dentro de ModalNuevaObra');
if (faltan.length) noArranco(faltan, archivo);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const seccion = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);

// ════════════════════════════════════════════════════════════════════════════
// 1) QUIÉN VE «+ NUEVA OBRA»
// ════════════════════════════════════════════════════════════════════════════
const gate = new Function(`"use strict";
  const esDependencia = ${decl['esDependencia']};
  const ROLES_ALTA_OBRA_C = ${decl['ROLES_ALTA_OBRA_C']};
  const ROLES_EDITAN_CONTRATO_D = ${decl['ROLES_EDITAN_CONTRATO_D']};
  const puedeAltaObra = ${decl['puedeAltaObra']};
  return { puedeAltaObra, ROLES_EDITAN_CONTRATO_D, ROLES_ALTA_OBRA_C };`)();

seccion('Quién da de alta una obra');

// La lista de dependencia es la del acto de adjudicación: quien adjudicó asienta
// el contrato. El supervisor levanta avance en campo y el administrativo recibe
// en ventanilla; ninguno de los dos contrata. El contralor fiscaliza.
for (const [rol, puede, porque] of [
  ['director_obras',   true,  'manda la dirección de Obras Públicas'],
  ['subdirector',      true,  'lo sustituye'],
  ['jefe_supervision', true,  'manda sobre el cuerpo de supervisión'],
  ['supervisor_obra',  false, 'verifica obra, no contrata'],
  ['administrativo',   false, 'recibe en ventanilla, no contrata'],
  ['contralor',        false, 'fiscaliza y no corrige'],
  ['contratista',      false, 'es el proveedor'],
]) {
  const r = gate.puedeAltaObra({ tipo: 'dependencia', rol });
  check(r === puede, `${puede ? 'SÍ' : 'NO'} da de alta obras en dependencia: ${rol}`, porque);
}

// Y la constructora no se quedó sin lo que ya tenía. Un cambio que abre un lado
// y cierra el otro no es un cambio, es una regresión con buena intención.
for (const [rol, puede] of [
  ['director_operaciones', true], ['gerente_construccion', true],
  ['director_general', false], ['admin_sistema', false], ['residente', false],
]) {
  const r = gate.puedeAltaObra({ tipo: 'constructora', rol });
  check(r === puede, `${puede ? 'SÍ' : 'NO'} da de alta obras en constructora: ${rol}`);
}

// El cruce que de verdad importa: un rol de dependencia NO se cuela por la lista
// de constructora ni al revés. Si el discriminante dejara de ser `tipo`, un
// `director_obras` caería del lado que no es — y es el defecto de `rutas-org`.
check(!gate.puedeAltaObra({ tipo: 'dependencia', rol: 'director_operaciones' }),
  'un rol de constructora no abre el alta estando en una dependencia');
check(!gate.puedeAltaObra({ tipo: 'constructora', rol: 'director_obras' }),
  'ni un rol de dependencia estando en una constructora');
check(!gate.puedeAltaObra({ rol: 'director_obras' }),
  'y sin `tipo` resuelto no se abre nada', 'cae del lado constructora, que no lo nombra');

// ── LA DERIVA CONTRA LAS REGLAS ─────────────────────────────────────────────
// La app ofrece el botón; las reglas son el candado. Si las dos listas no son
// la MISMA, una de las dos miente: o se ofrece un botón que rebota, o las reglas
// dejan pasar a quien la pantalla no deja pedir. Se lee de `firestore.rules` en
// vez de teclearla aquí porque el defecto que importa es que alguien mueva uno
// de los dos lados.
const reglas = fs.readFileSync(archivoReglas, 'utf8');
const listaRol = (fn) => {
  const m = reglas.match(new RegExp(`function ${fn}\\(\\)\\s*\\{[^}]*rol\\(\\)\\s*in\\s*\\[([^\\]]*)\\]`));
  if (!m) noArranco(`la función \`${fn}\` de firestore.rules, o su lista de roles`, archivoReglas);
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
};
const editorReglas = listaRol('esDirectivoDEditor');
check(editorReglas.join(',') === [...gate.ROLES_EDITAN_CONTRATO_D].sort().join(','),
  'la app y las reglas nombran a los MISMOS, sin deriva',
  `app: [${[...gate.ROLES_EDITAN_CONTRATO_D].sort().join(', ')}]  ·  reglas: [${editorReglas.join(', ')}]`);

// Y que ninguna regla de ESCRITURA de la obra de dependencia se guarde con la
// lista de LECTURA amplia. `esDirectivoD` incluye al contralor — ésa es su razón
// de ser, fiscaliza todo— así que usarla en un `allow write` le regala lo que la
// decisión de 2026-09 le niega. Estaba en SEIS renglones, y el alta de obra es
// justo lo que lo despertaba: la línea que crea la obra era uno de ellos.
const iniBloque = reglas.indexOf('match /orgs/{oid}/obras/{obraId} {');
const finBloque = reglas.indexOf('match /orgs/{oid}/config/branding');
if (iniBloque < 0 || finBloque <= iniBloque)
  noArranco('el bloque `match /orgs/{oid}/obras/{obraId}` de firestore.rules', archivoReglas);
const bloqueObraD = reglas.slice(iniBloque, finBloque);
const escriturasFlojas = bloqueObraD.split('\n')
  .filter(l => /allow\s+[a-z, ]*\b(create|update|delete|write)\b/.test(l))
  .filter(l => /esDirectivoD\(\)/.test(l));
check(escriturasFlojas.length === 0,
  'ninguna escritura de la obra de dependencia se guarda con la lista de LECTURA',
  escriturasFlojas.length
    ? `${escriturasFlojas.length} renglón(es): ${escriturasFlojas.map(l => l.trim()).join(' | ')}`
    : 'las seis usan esDirectivoDEditor');

// La otra dirección, para que el arreglo no se convierta en "borrar
// `esDirectivoD`": las LECTURAS sí tienen que seguir incluyendo al contralor.
check(/allow read:[^\n]*esDirectivoD\(\)/.test(bloqueObraD) || listaRol('esDirectivoD').includes('contralor'),
  'y el contralor sigue LEYENDO: fiscalizar es su trabajo',
  `esDirectivoD: [${listaRol('esDirectivoD').join(', ')}]`);

// ════════════════════════════════════════════════════════════════════════════
// 2) QUÉ PREGUNTA EL FORMULARIO
// ════════════════════════════════════════════════════════════════════════════
const campos = new Function(`"use strict";
  const esDependencia = ${decl['esDependencia']};
  const MODALIDADES_ADJUDICACION = ${decl['MODALIDADES_ADJUDICACION']};
  const CAMPOS_CONTRATO = ${decl['CAMPOS_CONTRATO']};
  const camposContrato = ${decl['camposContrato']};
  const CAMPOS_ALTA_C = ${decl['CAMPOS_ALTA_C']};
  // Las DOS expresiones salen del modal tal cual están escritas. Si alguien
  // borra el corte por tipo, se borra aquí también y la prueba se pone roja.
  const delAlta = usuario => {
    const dep = ${depModalSrc};
    return ${camposModalSrc};
  };
  return { delAlta };`)();

seccion('Qué pregunta el formulario de alta');

const clavesD = campos.delAlta({ tipo: 'dependencia' }).map(c => c.key);
const clavesC = campos.delAlta({ tipo: 'constructora' }).map(c => c.key);

for (const k of ['contrato', 'modalidad', 'empresaEjecutante', 'empresaRFC',
                 'supervisorDependencia', 'origenRecursos']) {
  check(clavesD.includes(k), `el alta de dependencia pregunta \`${k}\``);
}
// Y lo que NO pregunta, que es la mitad que se olvida. `cliente` es el defecto
// literal: se le estaba pidiendo al municipio su propio nombre, y encima era
// obligatorio.
for (const k of ['cliente', 'residente', 'admin']) {
  check(!clavesD.includes(k), `y NO le pide \`${k}\`, que es de la constructora`);
}
for (const k of ['cliente', 'residente', 'admin']) {
  check(clavesC.includes(k), `el alta de constructora sigue preguntando \`${k}\``);
}
check(!clavesC.includes('modalidad') && !clavesC.includes('origenRecursos'),
  'y no hereda los campos del municipio', clavesC.join(' · '));

// La modalidad de adjudicación es una lista CERRADA por ley. En casilla libre un
// capturista escribe «licitación» y otro «LP», y el informe del 73 deja de poder
// agruparse. Se afirma que el campo trae sus opciones y que el modal las pinta
// como tal: sin la rama de `opciones`, el `<Inp>` las ignoraría en silencio.
const modalidad = campos.delAlta({ tipo: 'dependencia' }).find(c => c.key === 'modalidad');
check(modalidad?.tipo === 'opciones' && (modalidad.opciones || []).length >= 3,
  'la modalidad de adjudicación viene con sus opciones de ley',
  (modalidad?.opciones || []).join(' · '));
check(/c\.tipo\s*===\s*["']opciones["']/.test(decl['ModalNuevaObra']),
  'y el modal distingue ese tipo en vez de pintar una casilla libre');

// ════════════════════════════════════════════════════════════════════════════
// 3) QUÉ NO SE PUEDE DEJAR EN BLANCO
// ════════════════════════════════════════════════════════════════════════════
const validez = new Function(`"use strict";
  const OBLIGATORIOS_ALTA = ${decl['OBLIGATORIOS_ALTA']};
  // La misma expresion que calcula valid en el modal.
  const esValido = (dep, form) =>
    OBLIGATORIOS_ALTA[dep ? "dependencia" : "constructora"].every(k => form[k]);
  return { esValido };`)();

seccion('Qué no se puede dejar en blanco');

const FORM_D = {
  id: 'OB-2026-ABC123', nombre: 'Pavimentación de la calle Hidalgo',
  contrato: 'MOP-COA-2026-014', modalidad: 'Licitación pública',
  empresaEjecutante: 'Constructora del Golfo SA de CV', empresaRFC: 'CGO010203AB1',
  supervisorDependencia: 'Ing. Pérez', superintendente: 'Ing. Ruiz',
  origenRecursos: 'FAISMUN 2026', presupuesto: '4850000',
  inicio: '2026-10-15', fin: '2026-12-20', estado: 'activa',
  pctAnticipo: 30, pctFondoGar: 5, pctRetencion: 0,
};
const FORM_C = {
  id: '0131', nombre: 'OBRA GP 0131', contrato: 'C-77', cliente: 'SCT Veracruz',
  superintendente: 'Ing. Ruiz', residente: 'Ing. Luna', admin: 'Lic. Soto',
  presupuesto: '12400000', inicio: '2026-10-01', fin: '2027-02-01', estado: 'activa',
};
const sin = (f, ...ks) => { const o = { ...f }; for (const k of ks) delete o[k]; return o; };

check(validez.esValido(true, FORM_D), 'el formulario de dependencia completo habilita el botón');
check(validez.esValido(false, FORM_C), 'y el de constructora también');

// LA COMPROBACIÓN DE LA QUE SALIÓ TODO: el formulario de dependencia NO trae
// `cliente`, así que compartir la lista de obligatorios dejaba el botón apagado
// para siempre con los ocho campos llenos.
check(validez.esValido(true, sin(FORM_D, 'cliente')),
  'y no se le exige `cliente`, que de ese lado no existe');
check(!validez.esValido(false, sin(FORM_C, 'cliente')),
  'pero a la constructora sí se le sigue exigiendo');

for (const k of ['nombre', 'contrato', 'modalidad', 'empresaEjecutante', 'presupuesto', 'inicio', 'fin']) {
  check(!validez.esValido(true, sin(FORM_D, k)),
    `sin \`${k}\` el alta de dependencia no se habilita`);
}
// Lo que se completa después en Contrato. Exigirlo aquí bloquearía el registro
// de una obra ya adjudicada por un dato que está en otro escritorio.
for (const k of ['empresaRFC', 'supervisorDependencia', 'origenRecursos', 'superintendente']) {
  check(validez.esValido(true, sin(FORM_D, k)),
    `y sin \`${k}\` sí se habilita: se completa en Contrato`);
}

// ════════════════════════════════════════════════════════════════════════════
// 4) EL IDENTIFICADOR
// ════════════════════════════════════════════════════════════════════════════
seccion('El identificador de la obra nueva');

const ids = new Function(`"use strict";
  const nuevoIdObra = ${decl['nuevoIdObra']};
  return nuevoIdObra;`)();

const generados = Array.from({ length: 5000 }, () => ids());
check(new Set(generados).size === 5000,
  '5000 identificadores seguidos, ninguno repetido',
  `${new Set(generados).size} distintos`);
check(generados.every(i => /^OB-\d{4}-[0-9A-Z]{6}$/.test(i)),
  'todos con la misma forma, y sin caracteres que Firestore no admita en un id',
  generados[0]);
check(generados.every(i => !/[/.]/.test(i)),
  'ninguno lleva diagonal ni punto', 'una diagonal partiría la ruta del documento');
check(ids.length === 0,
  'no se deriva de ningún campo del formulario',
  'un id sacado del número de contrato cambia cuando el número se corrige');

// ════════════════════════════════════════════════════════════════════════════
// 5) EL ALTA, EJECUTADA: QUÉ ESCRIBE Y QUÉ DEVUELVE
// ════════════════════════════════════════════════════════════════════════════
// Aquí no se lee código: se corre `agregarObra` sacada del archivo contra un
// Firestore de mentiras que puede decir "ya existe" o "denegada", y se mira qué
// quedó escrito, a quién se le avisó y si el modal se cerró.
const correrAlta = async ({ dep, form, yaExiste = false, fsSetFalla = null }) => {
  const reg = { gets: [], sets: [], obras: 0, notifs: [], audits: [],
                cerrado: false, selects: [], warns: [] };
  const fn = new Function('reg', 'entorno', `"use strict";
    const { dep, yaExiste, fsSetFalla } = entorno;
    const usuario = { correo: 'quien.captura@coatza.gob.mx', rol: 'director_obras' };
    const MXN = ${decl['MXN']};
    const ROLES_AVISO_OBRA_NUEVA = ${decl['ROLES_AVISO_OBRA_NUEVA']};
    const fsGet = async (p) => { reg.gets.push(p); return yaExiste ? { nombre: 'la que ya estaba' } : null; };
    const fsSet = async (p, d) => { reg.sets.push([p, d]); return !(fsSetFalla && fsSetFalla.test(p)); };
    const fsAudit = (a, d) => reg.audits.push([a, d]);
    const setObras = () => { reg.obras++; };
    const setModalNueva = (v) => { reg.cerrado = v === false; };
    const notifARoles = (roles, n) => reg.notifs.push([roles, n]);
    const onSelect = (id, destino) => reg.selects.push([id, destino]);
    const console = { warn: (...a) => reg.warns.push(a.join(' ')) };
    return ${agregarObraSrc};`)(reg, { dep, yaExiste, fsSetFalla });
  reg.resultado = await fn(form);
  return reg;
};

// Lo que sigue va dentro de una función: `agregarObra` y `entrar` son `async`
// —escriben a Firestore— y este archivo es CommonJS, donde no hay `await` de
// primer nivel. El cierre y la salida van DENTRO, porque si quedaran fuera se
// evaluarían con `fallas` todavía en cero y la prueba saldría verde sin haber
// corrido nada: un rojo silenciado es peor que un punto ciego.
const correr = async () => {

seccion('El alta, ejecutada');

// ── El camino bueno, dependencia ──
const okD = await correrAlta({ dep: true, form: FORM_D });
check(okD.resultado === null, 'el alta de dependencia devuelve "sin problema"',
  String(okD.resultado));
check(okD.sets.map(s => s[0]).join(' + ') === `obras/${FORM_D.id} + obras/${FORM_D.id}/config/info`,
  'y escribe los DOS documentos que la obra necesita para listarse y para leerse',
  okD.sets.map(s => s[0]).join(' + '));
// El monto llega como texto de la casilla y tiene que quedar como NÚMERO: si se
// guarda "4850000" en texto, toda suma del portafolio lo concatena.
check(typeof okD.sets[0]?.[1]?.presupuesto === 'number' && okD.sets[0][1].presupuesto === 4850000,
  'el monto contratado queda como número, no como el texto de la casilla',
  `${typeof okD.sets[0]?.[1]?.presupuesto} ${okD.sets[0]?.[1]?.presupuesto}`);
check(okD.sets[0]?.[1]?.modalidad === 'Licitación pública'
   && okD.sets[0]?.[1]?.empresaEjecutante === 'Constructora del Golfo SA de CV'
   && okD.sets[0]?.[1]?.origenRecursos === 'FAISMUN 2026',
  'y con él la modalidad, la empresa ejecutante y el origen de los recursos');
check(okD.obras === 1 && okD.cerrado, 'la obra entra a la lista y el modal se cierra');
check(okD.audits.length === 1 && okD.audits[0][0] === 'crear', 'queda una entrada de auditoría');

// El aviso: roles del lado correcto y el texto que corresponde. Antes nombraba
// tres roles de constructora, así que no le llegaba a nadie.
const [rolesD, notifD] = okD.notifs[0] || [[], {}];
check(rolesD.includes('director_obras') && rolesD.includes('contralor')
   && !rolesD.includes('director_general') && !rolesD.includes('admin_sistema'),
  'se le avisa a los directivos de la dependencia, no a los de constructora',
  rolesD.join(' · '));
check(/Constructora del Golfo/.test(notifD.mensaje || '')
   && /Monto contratado/.test(notifD.mensaje || '')
   && !/Sin cliente/.test(notifD.mensaje || ''),
  'y el aviso nombra a la empresa ejecutante y al monto contratado',
  notifD.mensaje);

// Y se entra directo al catálogo: una obra sin catálogo no acepta captura, así
// que dejar al usuario en la lista es dejarlo a un paso de una obra inservible.
check(okD.selects.length === 1 && okD.selects[0][0] === FORM_D.id
   && okD.selects[0][1]?.subTab === 'presupuesto',
  'y se entra a la obra directo al catálogo de conceptos',
  JSON.stringify(okD.selects[0]));

// ── El camino bueno, constructora: no se rompió ──
const okC = await correrAlta({ dep: false, form: FORM_C });
const [rolesC, notifC] = okC.notifs[0] || [[], {}];
check(okC.resultado === null && okC.obras === 1 && okC.sets.length === 2,
  'el alta de constructora sigue funcionando igual');
check(rolesC.includes('director_general') && !rolesC.includes('contralor'),
  'con sus propios destinatarios', rolesC.join(' · '));
check(/SCT Veracruz/.test(notifC.mensaje || '') && /Presupuesto/.test(notifC.mensaje || ''),
  'y su propio texto', notifC.mensaje);

// ── EL ID REPETIDO ──────────────────────────────────────────────────────────
// La peor de las cinco, porque no da error: `fsSet` escribe con `merge`, así que
// la obra nueva se funde con la que ya estaba, campo por campo. El contrato
// nuevo encima del monto viejo.
const choque = await correrAlta({ dep: true, form: FORM_D, yaExiste: true });
check(typeof choque.resultado === 'string' && /existe/i.test(choque.resultado),
  'con el identificador ya ocupado, el alta DICE que no se guardó',
  String(choque.resultado));
check(choque.sets.length === 0,
  'y no escribe NADA — ni se funde con la obra que ya estaba',
  `${choque.sets.length} escritura(s)`);
check(choque.obras === 0 && !choque.cerrado && choque.notifs.length === 0
   && choque.selects.length === 0,
  'ni la mete en la lista, ni cierra el modal, ni avisa, ni navega');

// ── LA ESCRITURA DENEGADA ───────────────────────────────────────────────────
// `fsSet` devuelve `false` cuando las reglas rechazan. Antes nadie lo leía y la
// obra aparecía en pantalla con su monto hasta que alguien recargara.
const negada = await correrAlta({ dep: true, form: FORM_D, fsSetFalla: /^obras\/[^/]+$/ });
check(typeof negada.resultado === 'string', 'una escritura denegada se reporta',
  String(negada.resultado));
check(negada.obras === 0 && !negada.cerrado,
  'y la obra NO aparece en la lista — ni el modal se cierra sobre el error');
check(negada.sets.length === 1 && negada.notifs.length === 0 && negada.selects.length === 0,
  'no se sigue escribiendo después del rechazo, ni se avisa de una obra que no existe');

// Y la mitad que SÍ se tolera: `config/info` es una relectura del mismo dato, y
// `obras/{id}` ya lo tiene entero. Abortar aquí dejaría la obra creada y al
// usuario creyendo que no. Se avisa en consola y se sigue.
const medio = await correrAlta({ dep: true, form: FORM_D, fsSetFalla: /config\/info$/ });
check(medio.resultado === null && medio.obras === 1,
  'si sólo rebota `config/info`, la obra queda: el documento de la obra ya la tiene entera');
check(medio.warns.length === 1, 'y se deja dicho en consola, porque indica reglas desalineadas',
  medio.warns[0]);

// ── SIN IDENTIFICADOR ───────────────────────────────────────────────────────
const sinId = await correrAlta({ dep: true, form: sin(FORM_D, 'id') });
check(typeof sinId.resultado === 'string' && sinId.sets.length === 0 && sinId.gets.length === 0,
  'sin identificador no se escribe nada, ni se pregunta a Firestore',
  'un `fsSet("obras/undefined")` crearía un documento con ese nombre');

// ════════════════════════════════════════════════════════════════════════════
// 6) DÓNDE ATERRIZA EL USUARIO
// ════════════════════════════════════════════════════════════════════════════
// `entrar` traduce el destino al menú de la sesión. Lo que se vigila es el caso
// que no se ve: si el destino NO existe en ese menú, hay que caer a la primera
// pestaña — quedarse donde estaba es quedarse en la pestaña de la obra ANTERIOR,
// con el título de la nueva.
const correrEntrar = async (usuario, destino) => {
  const reg = { tab: null, subPlan: null, subOper: null, screen: null, obraId: null };
  const fn = new Function('reg', 'usuario', `"use strict";
    const esDependencia = ${decl['esDependencia']};
    const LEXICO = ${decl['LEXICO']};
    const SUBTABS_OPERACION_DEPENDENCIA = ${decl['SUBTABS_OPERACION_DEPENDENCIA']};
    const SUBTABS_PLANEACION_DEPENDENCIA = ${decl['SUBTABS_PLANEACION_DEPENDENCIA']};
    const TABS_DEPENDENCIA = ${decl['TABS_DEPENDENCIA']};
    const TABS_POR_ROL = ${decl['TABS_POR_ROL']};
    const tabsDe = ${decl['tabsDe']};
    const DESTINOS_DEPENDENCIA = ${decl['DESTINOS_DEPENDENCIA']};
    const destinoNav = ${decl['destinoNav']};
    const setObraId = v => { reg.obraId = v; };
    const setScreen = v => { reg.screen = v; };
    const setTab = v => { reg.tab = v; };
    const setSubTabPlan = v => { reg.subPlan = v; };
    const setSubTabOper = v => { reg.subOper = v; };
    const setAuditObra = () => {};
    const setPermisosObraOverride = () => {};
    const fsGet = async () => null;
    const fsAudit = () => {};
    const obras = [];
    const navTab = ${navTabSrc};
    return ${entrarSrc};`)(reg, usuario);
  await fn('OB-2026-ABC123', destino);
  return reg;
};

seccion('Dónde aterriza el usuario después del alta');

const DEST_CAT = { tab: 'planeacion', subTab: 'presupuesto' };
const aD = await correrEntrar({ tipo: 'dependencia', rol: 'director_obras' }, DEST_CAT);
check(aD.tab === 'contrato' && aD.subPlan === 'presupuesto',
  'en dependencia el catálogo vive bajo Contrato, y ahí aterriza',
  `${aD.tab} / ${aD.subPlan}`);
const aC = await correrEntrar({ tipo: 'constructora', rol: 'director_operaciones' }, DEST_CAT);
check(aC.tab === 'planeacion' && aC.subPlan === 'presupuesto',
  'y en constructora bajo Planeación', `${aC.tab} / ${aC.subPlan}`);

// El respaldo. Un destino que el menú de la sesión no ofrece NO puede dejar la
// pestaña sin fijar: `setTab` tiene que correr igual.
const aNada = await correrEntrar({ tipo: 'dependencia', rol: 'director_obras' }, { tab: 'gastos' });
check(aNada.tab === 'dash',
  'un destino que el menú no ofrece cae a la primera pestaña, no se queda en la anterior',
  String(aNada.tab));
const aSin = await correrEntrar({ tipo: 'dependencia', rol: 'director_obras' }, null);
check(aSin.tab === 'dash', 'y entrar sin destino sigue abriendo la primera pestaña',
  String(aSin.tab));
check(aD.screen === 'obra' && aD.obraId === 'OB-2026-ABC123',
  'en todos los casos se entra a la obra que se acaba de crear');

// ════════════════════════════════════════════════════════════════════════════
console.log(fallas === 0
  ? '\nUna dependencia da de alta su obra, con sus campos, y el alta no se pierde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);

}; // ── fin de `correr` ───────────────────────────────────────────────────────

// Un rechazo de promesa sin atrapar sale con código 1 en Node, pero sin decir
// qué pasó. Se atrapa para que un reventón se distinga de un rojo: una excepción
// es que la prueba NO ARRANCÓ hasta el final, no que la conducta esté mal.
correr().catch(e => {
  console.error('\nLa prueba reventó antes de terminar de comprobar:');
  console.error(e);
  process.exit(NO_ARRANCO);
});


// ── CONTRAPRUEBAS: 16 MUTACIONES, CONTEOS MEDIDOS ───────────────────────────
// Cada una se aplicó al archivo real, se corrió esta prueba y se restauró. Los
// números de abajo son lo que salió, no lo que se esperaba.
//
//   4  `puedeAltaObra` sin el corte por tipo (`ROLES_ALTA_OBRA_C` a secas):
//      ningún rol de dependencia ve el botón. Es el defecto original.
//   2  `ROLES_EDITAN_CONTRATO_D` con `supervisor_obra` dentro: se le ofrece el
//      alta a quien las reglas van a rebotar, y la deriva app/reglas se delata.
//   1  `allow create, update, delete` de la obra de vuelta a `esDirectivoD()`:
//      el contralor vuelve a poder crear y borrar obras.
//   9  `const campos = CAMPOS_ALTA_C` sin el corte por tipo: se le piden al
//      municipio `cliente`, `residente` y `admin` y nada de su contrato.
//   6  `OBLIGATORIOS_ALTA.dependencia` = los de constructora: con los campos
//      del municipio llenos el botón sigue apagado porque falta `cliente`.
//   1  `OBLIGATORIOS_ALTA.dependencia` sin `modalidad`: se registra una obra
//      sin decir cómo se adjudicó.
//   2  `nuevoIdObra` consecutivo sobre la lista cargada: 5000 seguidos repiten,
//      y además recibe argumento.
//   3  sin el `if (await fsGet(...)) return`: el id ocupado escribe encima y
//      `merge` funde los dos contratos sin dar error.
//   3  el booleano de `fsSet` ignorado: la obra denegada aparece en la lista.
//   5  `setObras` optimista ANTES de escribir: la mutación más inocente de las
//      dieciséis y la que pinta cifras que no están guardadas.
//   2  abortar también cuando rebota `config/info`, que va en la dirección
//      contraria: la obra QUEDÓ creada y se le dice al usuario que no. Está
//      para que la prueba no acabe pidiendo que se aborte donde no se debe.
//   1  `notifARoles` con la lista de constructora en los dos casos: el aviso
//      del municipio no le llega a nadie.
//   1  el mensaje con `nueva.cliente` siempre: dice «Sin cliente» de una obra
//      que sí tiene quien la ejecute.
//   1  sin el `onSelect` del final: se queda en la lista, a un paso de una obra
//      sin catálogo.
//   1  `navTab` sin devolver nada y `entrar` sin el respaldo: el destino que el
//      menú no ofrece deja pintada la pestaña de la obra anterior.
//
// Y una sobre la prueba misma (P4): renombrar `agregarObra` → salida 2, NO
// ARRANCÓ. Lo atrapan `dentroDe` y `NECESARIOS`, que es lo que debe pasar: una
// prueba que no encuentra lo que iba a medir no se declara verde.
