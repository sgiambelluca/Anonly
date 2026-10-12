<!-- CONTEXT: scope=plan-hardening | dependencias=roadmap/Roadmap_1.x.md,roadmap/hardening/Confianza_1.0.x_Plan.md,adr/ADR-124-La-Unidad-De-Alcance-Es-El-Commit-No-El-PR.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-194-Automatico-Elige-El-Perfil-De-Rendimiento-Segun-El-Equipo.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md,adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md,adr/ADR-214-La-Que-Pierde-Un-Conflicto-No-Se-Descarta-Si-Cubre-Mas-Texto.md,core/Regex_Engine.md,core/OCR_Engine.md,roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md,roadmap/mediciones/ocr/ADR190_OSD_Recuperacion_2026-09-28.md,roadmap/hardening/Validar_Muestra_Diseno_2026-10-09.md,tests/perf/README.md,RELEASING.md,roadmap/mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md,adr/ADR-217-Una-Direccion-Con-Palabra-Clave-Es-Un-Patron.md | audiencia=humanos+IA | fase=12 -->

# Confianza — cierre del bloque (plan de la branch)

Branch `hardening/confianza-cierre`, creada desde `develop` el 2026-10-08. Es
una branch de campaña (ADR-124): toca varios módulos, y cada commit toca uno.

Cierra lo que queda abierto de `Roadmap_1.x.md` §3 después del lote del
2026-10-07 ([`Confianza_1.0.x_Plan.md`](Confianza_1.0.x_Plan.md)).

## Qué decidió el mantenedor (2026-10-08)

- **Todo sale junto, en una sola versión.** No se publica antes lo que ya
  está en `develop` (el lote de Confianza y «Avisos y novedades»): se espera a
  cerrar este bloque.
- **Decisión histórica sobre «Validar muestra»:** se había previsto un botón
  opcional al terminar el export. **Reemplazada por su retiro el 2026-10-11.**
- **Direcciones: entra un patrón por palabra clave**, que no dependa de que el
  texto esté en mayúsculas o en minúsculas. Lo que sigue a «Av.» es el nombre
  de una calle, esté escrito como esté. El patrón por forma («en Urquiza 98»,
  sin palabra clave) queda afuera.
- **M2 se repite ya.**

**El 2026-10-09**, con los números de M-O1:

- **El riesgo aceptado de ADR-190 no se cierra todavía como aceptado**: se
  mide una señal sobre escaneos reales antes de decidir.
- **El renglón solo escaneado de costado se cierra en esta versión**, con
  una medición previa del costo.
- **El comparador del paso 2 de la cadena pasa a confianza de página**, en
  la misma enmienda, si la medición de las páginas con texto solo en el
  margen no lo contradice.
- **No se commitea nada hasta que estén todos los puntos cerrados y el
  revisor apruebe el lote.** Las mediciones del «después» corren sobre el
  árbol sin commitear, quedan marcadas como provisionales y se repiten sobre
  el commit.

## Flujo de revisión y PR autorizado (2026-10-11)

El mantenedor autorizó el ciclo Sol → Luna si hay rechazos → Sol hasta
APPROVED. Tras la aprobación y la auditoría de datos sensibles en la
documentación, el planificador prepara commits por módulo, pushea esta
branch y abre el PR hacia `develop`. Esta instrucción posterior gobierna
la preparación del PR; no autoriza release, versión ni tag.

La primera revisión integral terminó REJECTED: lint no cubría la configuración
del build aislado, esa configuración exportaba default y había catorce
casts dobles prohibidos en observadores/tests. La corrección se limita al
instrumento y los tipos, con el plan en
[Costo_RC_Aislado_Protocolo_2026-10-10.md](../ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md).
Los demás gates mínimos pasaron. Sol no detectó datos sensibles en el lote
publicable revisado.

**Segunda revisión: APPROVED para commits, push y PR hacia develop.** Sol
confirmó personalmente los cinco gates mínimos: lint, tipos, 4408 tests
verdes (un fallo esperado, 77 omitidos), 347/347 contratos y formato, además
de `git diff --check`. Revalidó specs, contratos, eventos, errores, casos
límite y prohibiciones, sin debilitamiento de tests. Confirmó el smoke
corregido 8/8, renderer RC igual al normal, identidad y restauración, y la
vigencia de las evidencias export 23/23 y N1 4/4. La auditoría manual de
privacidad no detectó datos sensibles ni artifacts privados en los 143
archivos publicables. La partición aprobada separa documentación, Regex,
OCR, instrumentos por grupo, E2E y changesets en trece commits. Los estados
de «revisión pendiente» del registro previo describen el momento anterior
a esta aprobación; esta sección registra el estado actual.

M2 final pasó sobre el producto del PR #63 el 2026-10-11: P1 máximo
1606,3 MB y P2 máximo 2820,1 MB, nueve pares válidos sin suspensión.
El [registro](../mediciones/transversal/Memoria_Final_Confianza_2026-10-11.md)
preserva corridas, identidad y límites. El mantenedor autorizó el merge si
la medición y los checks del PR cumplen. La repetición de otras mediciones
provisionales sobre el commit sigue siendo una obligación antes de publicar
la versión, según §11.4 de
`07_Performance_Strategy.md`. No se sustituyen por la medición histórica
de develop ni por P2N/R4, y no se declaran cumplidas al abrir el PR.

El PR #63 se integró el 2026-10-11 tras M2 y los checks verdes del PR.
El CI posterior en develop falló en dos casos de Export verification.
La corrección del arnés y su validación se siguen en
[el registro del incidente](Export_Verification_CI_2026-10-11.md).
La corrección pasó 23/23 en Windows y CI/macOS, con revisión Sol APPROVED;
su integración se condiciona a los checks del HEAD final del PR #64.
M2 conserva su validez: la corrección solo toca pruebas y documentación.

**Versión asignada el 2026-10-12: 1.0.2.** El mantenedor solicitó el PR
de promoción de develop hacia main. La preparación de versión, novedades
y los requisitos restantes antes del tag se registran en
[Preparación de 1.0.2](Release_1.0.2_Preparacion_2026-10-12.md).
Esta decisión reemplaza la falta de número del registro histórico;
no declara cumplidas las repeticiones provisionales ni publica la versión.

## Retiro de «Validar muestra» (2026-10-11)

El mantenedor decidió no desarrollar esta función y quitarla del roadmap.
Prioriza la revisión manual del documento y la configuración de todas las
entidades antes de exportar. Quedan canceladas las consultas de flujo,
comparación y costo, así como ADR/contratos, implementación y mediciones
del flujo futuro. No se desarrolló la función. M-V1, su diagnóstico y la
propuesta se conservan como antecedentes históricos; sus fallos y limitaciones
siguen registrados. El gate técnico independiente del export sigue vigente.

## Qué queda abierto de §3, auditado el 2026-10-08

**Decisión posterior del 2026-10-10:** cerrar OCR con RC y conservar el
riesgo residual de orientación como el único punto abierto de
1.0.x — Confianza, con estado **pendiente de desarrollo**. SV y la extensión de CP se retoman cuando
el mantenedor disponga de más documentos/escaneos; no se adopta 0,8.
Esto reemplaza la decisión condicional anterior sobre el comparador del
paso 2. La evidencia, limitaciones y condiciones de retoma están en
[Orientacion_SV_CP_Retoma_2026-10-10.md](../ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).
El resto del lote continúa hasta cerrar validaciones y revisión;
no se marca completo mientras haya trabajos en curso.

| Punto de §3 | Estado al empezar | Frente |
|---|---|---|
| Gate que lee el PDF exportado | cerrado e integrado | 5, dos casos que le faltan |
| Emails en escaneos de baja resolución | cerrado. Quedan 2 perdidos al forzar la lectura a 150 dpi, fuera del alcance de ADR-211 | — |
| Página escasa y girada | riesgo aceptado de ADR-190, sin trabajo hecho | 3 |
| Direcciones | cerrado con un límite: las calles que el modelo no marca | 2 |
| Firma de Windows | cerrado sin firma | — |
| Repintado de línea | cerrado | 5, un caso en el gate |
| Memoria | perfil Bajo cerrado; falta repetir M2 | 1 |

## Orden de trabajo

Las mediciones van primero y de a una: compiten por CPU y memoria entre sí y
con los gates de un sub-agente. Mientras corre una medición, el planificador
escribe los documentos del frente siguiente.

**Coordinación en Codex (2026-10-10):** por instrucción del mantenedor,
el implementador usa Luna y el revisor Sol. Se conserva un solo subagente
activo por vez y la revisión del lote al final. RC aislado pasó el smoke
8/8 y la campaña de costo terminó 12/12 válida, provisional: R1 agrega
0,394/1,022 s hasta Ready; P2N, diez hojas de ruido, 19,884/19,112 s.
El humano aceptó RC el 2026-10-10 y dejó SV/CP pendiente. ADR-190 y el
spec OCR v1.18.0 se enmendaron antes del código. La confirmación adoptada
pasó smoke 8/8 y costo 12/12: R1 agregó 1,185/0,952 s hasta Ready y P2N
19,452/18,713 s. M2 de R1 quedó dentro del ruido; P2N frío aumentó
470,8 MB con rangos separados y caliente 351,5 MB con rangos superpuestos.
Presión por importación no disponible en las 24 ventanas. La calidad
normativa pasó con 26 documentos, 78 entidades cubiertas y 18 falsos
positivos, sin regresiones frente a la baseline. M-O1 sobre RC terminó
700/700 con los mismos 140 hashes: solo cuatro N1 recuperados y cuatro
controles de ruido con más lecturas; 692 registros iguales y cero cambios
inesperados en la proyección observada. M-V1 terminó con esa identidad:
36/36 registrados, 30 flujos exitosos y seis lecturas parciales de R4;
sin invalidaciones ni errores del instrumento. El gate ampliado terminó
23/23, sin fallos ni salteados; la revisión del lote sigue pendiente.

La reparación del arnés M-V1 pasó 25 pruebas focalizadas, tipos, lint,
formato y sintaxis shell. La auditoría corrigió la compatibilidad del crudo
histórico sin preparación y la comprobación de diálogos sin radio de grafía.
El análisis offline conserva el intento anterior como incompleto: 36
esperadas, una registrada, 35 faltantes, falla del instrumento en export.
El smoke nuevo terminó válido en R1-low-r1 y los dos sintéticos de diez
páginas; todavía no acredita la matriz de 36 ni la función de producto.

| Paso | Frente | Qué | Quién | Estado |
|---|---|---|---|---|
| 1 | Memoria | M-M2: repetir `memory.spec.ts` sobre `develop` | planificador | **medido el 2026-10-08**: P1 máximo 1619,0 MB y P2 máximo 2813,1 MB, los dos debajo de su techo |
| 2 | Direcciones | M-D2: línea de base del caso con palabra clave, en minúsculas y en mayúsculas | implementador (`tests/perf`) y planificador | **medido el 2026-10-08**: algo a la vista en 41 de 138 páginas (8 en escritura normal, 16 y 17 en mayúsculas) |
| 3 | Página escasa | M-O1: qué pasa con un veredicto de orientación equivocado, y cuánto cuesta verificar ángulos | implementador (`tests/perf`) y planificador | **medido el 2026-10-09**: ningún veredicto equivocado natural en las 48 páginas con veredicto; con uno forzado, 194 de 384 sin texto esperado ni aviso (178 sin el indicador de DNI esperado y 16 con él); no se leyó el export; hueco natural del renglón solo de costado |
| 5 | Direcciones | ADR y spec de Regex; implementación; medición del después | mantenedor, planificador, implementador | ADR-217 **aceptado** el 2026-10-08, con `Regex_Engine.md` v1.16.0; la implementación en `regex-engine` implementado y **medido el 2026-10-09** (M-D3, provisional): 4 páginas a la vista de 138, 0 trampas en escritura normal y 12 de 18 en mayúsculas, como se esperaba; falta el revisor y repetir sobre el commit |
| 6 | Página escasa | Decisión con los números de M-O1; si se adopta, ADR y spec de OCR | mantenedor, planificador, implementador | RC aceptado e implementado el 2026-10-10; ADR-190/spec v1.18.0, 229 pruebas OCR verdes, N1 export 4/4, seis regresiones verdes, calidad normativa y costo adoptado confirmados; M-O1 700/700 sin cambios inesperados; revisión del lote pendiente; SV/CP pendiente de desarrollo hasta disponer de más escaneos |
| 8 | Gate del export | Un caso de renglón repintado y la medición de los restos de tinta | implementador (`tests/e2e`) | implementación y validación local completas: 23/23, cero fallos/salteados/flaky; conserva las 21 filas y agrega dos controles discriminantes; revisión del lote pendiente |
| 9 | Publicación | Changeset que falta, novedades, limitaciones conocidas | planificador | al final |
| 10 | Revisión | El lote entero | revisor | al final |

## Frente 1 — Memoria: repetir M2 (M-M2)

**Pregunta.** ¿El máximo de M2 de P1 y de P2 sigue debajo de sus techos
(2,0 GB y 3,0 GB, ADR-192 §2) sobre el producto de hoy?

**Por qué se repite.** El 2026-10-01 el máximo de P2 quedó a 106 MB del
techo, y el ruido de M2 entre corridas iguales es de unos 345 MB (ADR-146
§7). Además, desde esa medición entraron cambios de producto en los cuatro
motores de detección y en el visor.

**Cómo.** El mismo instrumento y el mismo banco que el 2026-10-01:
`tests/perf/memory.spec.ts --repeat-each=3`, en Windows nativo, con la
aplicación recién construida y sin otra suite corriendo. El instrumento fija
el nivel `medium` (ADR-194 §8), que es el de esos techos.

**Después.** El planificador actualiza ADR-192 («Medición») y el ítem de
`Roadmap_1.x.md` §3. Si un máximo supera su techo, vuelve al mantenedor con
el número: el techo no se sube en silencio (ADR-192 §4).

### Resultado de M-M2 (2026-10-08)

Producto de `develop` del 2026-10-08, con el árbol limpio y la aplicación
recién construida. Windows 11 nativo, i5-12400, 12 hilos y 16,9 GB de RAM.
Nueve corridas, todas válidas, en 7,1 minutos. MB decimales.

| Perfil | M2 frío | M2 caliente | Máximo | Techo | Margen |
|---|---|---|---:|---:|---:|
| P1 | 1588,3 / 1619,0 / 1610,7 | 1293,2 / 1312,1 / 1288,9 | 1619,0 | 2,0 GB | 381 |
| P2 | 2151,4 / 2004,6 / 2191,9 | 2813,1 / 2810,3 / 2806,0 | 2813,1 | 3,0 GB | 187 |
| P2-dense (informativo) | 2263,1 / 2286,2 / 2231,6 | 2709,8 / 2739,7 / 2711,7 | 2739,7 | sin techo | — |

- **P1 y P2 cumplen**, igual que el 2026-10-01.
- El máximo de P2 bajó de 2894,2 a 2813,1 MB entre las dos tandas. La
  diferencia, 81 MB, es menor que el ruido: no dice que el producto use menos
  memoria.
- **El margen de P2 sigue siendo menor que el ruido** (187 MB contra unos
  345 MB). Con las dos tandas, las seis corridas calientes de P2 van de
  2660,9 a 2894,2 MB y ninguna supera el techo.
- Tiempos, como control de que el producto es el mismo: P1 en frío, de 1,9 a
  2,0 s; P2 en frío, de 19,3 a 20,5 s. Los grupos coinciden entre corridas
  (14, 11 y 243).
- Los crudos del 2026-10-01 quedaron guardados aparte en el banco, sin
  pisar.

Por la regla de ADR-192 §4 el ítem se cierra: el máximo quedó debajo del
techo. La salvedad del margen no se cierra midiendo otra vez; se cierra
bajando el consumo o cambiando el techo, y eso es decisión del mantenedor.

## Frente 2 — Direcciones por palabra clave

**Lo que ya se sabe.**

- La aplicación no tiene un detector de direcciones. El modelo de nombres
  marca «lugares», el motor los convierte en dirección y ADR-212 les suma el
  número que sigue. Si el modelo no marca la calle, calle y altura quedan a
  la vista.
- M-D1 (2026-10-07): en 9 de 48 oraciones con un domicilio el modelo no
  marcó la calle. Las 9 son oraciones sin una palabra de domicilio antes de
  la calle. Con la palabra antes, la marcó en todas.
- En mayúsculas el modelo falló aun con la palabra: «CON DOMICILIO EN MAIPU
  1434» y «CON DOMICILIO EN BELGRANO 1950» salieron sin ninguna detección.
  Son dos oraciones vistas en la revisión del lote, no una medición.
- `Regex_Engine.md` §3 dice que detectar direcciones no es tarea de Regex.
  El precedente para cambiarlo es la carátula (ADR-092): un formato fijo es
  un patrón, aunque el tipo sea de los que detecta el modelo.

**Decidido por el mantenedor el 2026-10-08.** Un patrón anclado en la
palabra clave, que valga igual en mayúsculas y en minúsculas. El patrón por
forma queda afuera.

### M-D2 — línea de base del caso con palabra clave

**Pregunta.** Con una palabra clave antes de la calle, ¿qué deja a la vista
la aplicación de hoy, en minúsculas y en mayúsculas? Es el punto de partida
contra el que se compara el patrón.

**Corpus.** Oraciones sintéticas nuevas, escritas por el planificador y
entregadas al implementador como datos: no se cambian ni se acomodan
(`tests/perf/README.md`, «Altura de las direcciones»). Cada oración base se
mide en tres escrituras: como se escribe normalmente, toda en mayúsculas con
tildes, y toda en mayúsculas sin tildes.

| Categoría | Qué es | Ejemplo |
|---|---|---|
| K1 | Palabra de vía y altura | «La oficina funciona en Av. Corrientes 1980.» |
| K2 | Palabra de domicilio, sin palabra de vía | «Con domicilio en Maipú 1434 de esta ciudad.» |
| K3 | Nombre de varias palabras | «Vive en Av. Presidente Roque Sáenz Peña 1234.» |
| K4 | Nombre con número o fecha | «Constituyó domicilio en calle 25 de Mayo 350.» |
| K5 | Calle numerada | «Reside en calle 50 N° 889 de La Plata.» |
| K6 | Sin altura | «El hecho ocurrió en Av. Corrientes y Maipú.» |
| K7 | Con piso o departamento después | «Sito en calle Lavalle 385, piso 3, depto. B.» |
| K8 | Trampas: la palabra clave sin una dirección | «La calle estuvo cortada 3 horas.» |

Las palabras clave del corpus:

- de vía: «calle», «avenida», «Av.», «Avda.», «pasaje», «Pje.», «boulevard»,
  «Bv.», «diagonal», «ruta»;
- de domicilio: «domicilio en», «domiciliado en», «domiciliada en», «con
  domicilio real en», «sito en», «sita en».

**Qué se registra por oración y por escritura.**

- Las direcciones detectadas, con su valor.
- Si la calle y la altura quedaron cubiertas enteras, en parte o nada.
- En K8, qué se tapó de más.
- Qué otra detección toca el tramo (por ejemplo, una patente sobre «MAR
  450», el cruce que arregló ADR-214).

Dos corridas completas, con el modelo real y la configuración por defecto,
sobre el arnés de M-D1. Windows nativo. No cambia producto.

**Salida.** Un informe en `mediciones/ner/`, solo con datos sintéticos.

**Después.** Con el informe, el planificador escribe el ADR y la enmienda
del spec de Regex. Quedan para decidir ahí, con los casos medidos:

- la lista de palabras clave;
- si la palabra de vía forma parte del valor (el modelo hoy la incluye:
  «Av. Corrientes 1980»);
- qué se hace con una dirección sin altura, sobre todo en mayúsculas, donde
  nada marca dónde termina el nombre;
- si el patrón incluye piso y departamento, que ADR-212 dejó afuera;
- cuántas palabras puede tener el nombre de la calle.

### Resultado de M-D2 (2026-10-08)

Informe:
[`Direcciones_Con_Palabra_Clave_2026-10-08.md`](../mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md).
Arnés nuevo: `./tests/perf/run-address-keyword.sh`.

- La calle o la altura quedan a la vista en 41 de 138 páginas: 8 de 46 en
  escritura normal, 16 en mayúsculas con tildes y 17 en mayúsculas sin
  tildes.
- No es solo un problema de mayúsculas. «pasaje Rauch 742», «diagonal Norte
  615», «12 de Octubre 1575» y las calles numeradas fallan en las tres
  escrituras.
- Con palabra de domicilio y sin palabra de vía, falla solo en mayúsculas.
- Una dirección sin altura queda tapada en las 18 páginas: el borde que se
  había anotado no aparece. Queda afuera solo la calle numerada sin altura
  («calle 13 entre 44 y 45»).
- Las dos corridas son válidas y coinciden. Ninguna oración tuvo que
  cambiarse.

**Evaluado fuera de línea por el planificador**, sobre el texto del corpus y
sin correr el producto: un patrón que exige mayúscula inicial o dígito en
cada palabra del nombre cerraría 37 de las 41 y no tocaría ninguna trampa en
escritura normal. En un texto todo en mayúsculas taparía de más 6 de 9
trampas, porque ahí nada distingue un verbo de un nombre de calle. Queda
afuera «ruta 205 kilómetro 54».

**Decidido por el mantenedor el 2026-10-08**: una sola regla para las tres
escrituras, aceptando lo que tapa de más en mayúsculas. Propuesta completa
en
[ADR-217](../../adr/ADR-217-Una-Direccion-Con-Palabra-Clave-Es-Un-Patron.md),
con `Regex_Engine.md` v1.16.0 (caso 36). **Aceptado por el mantenedor ese
mismo día**, con el detalle de las listas y de los límites.

### M-D3 — después del cambio

El arnés de M-D2 se vuelve a correr con el patrón implementado. Se espera:
algo a la vista en 4 páginas de 138 (eran 41), ninguna trampa tapada en
escritura normal y 12 de 18 en mayúsculas. Además, M-D1 sin cambios y la
línea de base de calidad sin entidades perdidas. Si un número no se cumple,
vuelve al mantenedor.

**Resultado (2026-10-09, provisional).** Se cumplen los tres números y
ninguna página difiere de lo esperado: 4 a la vista, 0 trampas en escritura
normal, 12 de 18 en mayúsculas. El patrón cierra 37 páginas que el modelo
dejaba a la vista y no descubre ninguna. M-D1 da los totales de la regla
vigente; calidad, 78 de 78 sin regresiones; peores casos, lineal. Detalle en
el [informe](../mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md),
«Después del cambio».

Es provisional porque el patrón estaba sin commitear al medir. Los arneses
ganaron una salida explícita para eso
(`ANONLY_CAMPAIGN_ALLOW_UNCOMMITTED_PRODUCT=1`), que deja la corrida
marcada. Se repite sobre el commit antes de publicar.

## Frente 3 — Página escasa y girada

**El riesgo, tal como lo dejó ADR-190.** Si la detección de orientación da
un veredicto equivocado sobre una página con muy poco texto, y la lectura en
ese ángulo es basura con confianza alta, la página se considera leída: no se
prueban otros ángulos, no se marca como ilegible, y se exporta sin tapar y
sin aviso. El mantenedor lo aceptó como riesgo el 2026-09-29.

**Lo que ya se sabe.**

- En la campaña de ADR-190 no apareció ningún veredicto equivocado: sobre 64
  PDF sintéticos, 48 veredictos correctos y 16 ausencias. Las ausencias las
  cubre la enmienda del 2026-09-28.
- La geometría importa: un E2E con otro tamaño de página y de letra encontró
  un camino que el corpus de 64 no tenía.
- Comparar las cuatro lecturas por la confianza de página eligió el ángulo
  correcto en 64 de 64. Comparar por cantidad de palabras confiables, en 32
  de 64 (`ADR190_OSD_Recuperacion_2026-09-28.md`).
- El arnés de esa campaña ya sabe forzar el ángulo de la primera lectura.

### M-O1 — veredicto equivocado y costo de verificar ángulos

**Preguntas.**

1. ¿Aparece un veredicto equivocado si se amplía el corpus con otras
   geometrías?
2. Si el veredicto fuera equivocado, ¿en cuántas páginas la basura cumple el
   criterio de lectura fiable y la página sale sin aviso?
3. ¿Qué señal de la primera lectura separa una página bien leída de una mal
   orientada, para decidir cuándo probar los otros ángulos?
4. ¿Cuánto cuesta, en tiempo y en memoria, probarlos con esa señal?

**Corpus.** Todo sintético.

- Los 64 PDF con texto y los 12 controles de la campaña de ADR-190, sin
  cambios. Sus cuatro densidades ya incluyen la página completa, que sirve
  de control denso.
- 64 PDF nuevos de página escasa: las ocho geometrías de abajo, en los
  cuatro ángulos reales (0, 90, 180 y 270) y a 150 y 300 dpi. El texto es el
  de la campaña anterior, «Juan Perez DNI 34.567.891», repartido en los
  renglones que diga la geometría.

| Geometría | Página | Letra | Texto |
|---|---|---|---|
| N1 | A4 | 12 pt | un renglón, centrado |
| N2 | A4 | 9 pt | un renglón, arriba a la izquierda |
| N3 | A4 | 14 pt | tres renglones, abajo a la derecha |
| N4 | A4 | 36 pt | una palabra y el número, centrados |
| N5 | Oficio, 612 × 1008 pt | 12 pt | dos renglones, arriba |
| N6 | A5, 420 × 595 pt | 11 pt | dos renglones, centrados |
| N7 | 280 × 220 pt | 26 pt | dos renglones (la geometría del E2E que encontró un camino nuevo) |
| N8 | A4 | 10 pt | dos renglones en dos columnas, uno en cada mitad |

Si una geometría no se puede generar tal cual, es un hallazgo: no se cambia
por otra.

**Qué se registra por PDF.**

- El veredicto de orientación natural, su confianza, y si coincide con el
  ángulo real.
- La lectura en cada uno de los cuatro ángulos: palabras, palabras con
  confianza ≥ 60, confianza de página, y si están los datos esperados.
- El tiempo de cada lectura.
- **El resultado del producto con un veredicto forzado** a cada uno de los
  cuatro ángulos: qué lectura entrega la cadena de ADR-190, si están los
  datos esperados, si la página queda marcada como ilegible, qué ángulos
  probó y cuánto tardó. Lo que se fuerza es un veredicto, no su ausencia: el
  caso sin veredicto ya está medido y cubierto.

**Qué se calcula después, sin volver a correr.** Para cada señal candidata
(pocas palabras confiables en la primera lectura; confianza de página baja;
las dos):

- cuántas páginas mal orientadas dispara y cuántas deja pasar;
- cuántas páginas bien orientadas dispara de más, que es el costo;
- si la comparación por confianza de página elige el ángulo correcto.

La memoria se mide aparte, en una segunda tanda, solo para la señal que
quede como candidata.

**Salida.** Un informe en `mediciones/ocr/`.

**Después.** El mantenedor decide con los números: adoptar una señal, con su
ADR y la enmienda de `OCR_Engine.md`, o dejar el riesgo aceptado, ahora con
una búsqueda hecha. No cambia producto hasta esa decisión.

### Resultado de M-O1 (2026-10-09)

Informe:
[`Veredicto_De_Orientacion_Equivocado_2026-10-09.md`](../mediciones/ocr/Veredicto_De_Orientacion_Equivocado_2026-10-09.md).
700 de 700 observaciones sobre 140 PDF, sin fallas del instrumento.

1. **Veredictos equivocados: ninguno.** 48 veredictos sobre 128 PDF con
   texto, los 48 correctos. En las ocho geometrías nuevas el OSD no afirmó
   ningún ángulo (64 de 64 sin veredicto).
2. **Con un veredicto equivocado forzado**, la lectura queda sin el texto
   esperado y sin aviso en 194 de 384 casos; 178 no tienen el indicador de
   DNI esperado y 16 sí. La clasificación histórica añadía siete lecturas
   con forma de DNI y dígitos distintos: no tienen el indicador del DNI
   esperado. El aviso de página ilegible no se emitió nunca.
   Esta proyección no compara todas las entidades ni sus cajas y no lee el
   PDF exportado: esos casos no acreditan por sí solos datos visibles en él.
3. **Señales.** Contar palabras confiables dispara de más en toda página
   escasa. La confianza de página es la mejor, pero las lecturas correctas
   (0,85 a 0,96) y las equivocadas (hasta 0,91) se pisan, y el corpus es
   sintético: su costo sobre escaneos reales no está medido.
4. **Comparar las cuatro lecturas por confianza de página** eligió el ángulo
   correcto en 128 de 128. Por cantidad de palabras confiables, en 51.
5. **Costo.** Tres lecturas más: 1,2 s de mediana en caliente (estimación),
   3,7 s en frío. Memoria sin medir.

**Dos hallazgos que el plan no buscaba.**

- **Un renglón solo, escaneado de costado, sale sin leer y sin aviso** (N1 a
  90° y 270°, 4 de 4, en producción y sin forzar nada). El OSD no da
  veredicto, la primera lectura viene vacía y la tinta (0,0012 a 0,0018)
  queda debajo de `INK_PRESENT_RATIO`, así que la rama «sin veredicto» no
  prueba los otros ángulos. El umbral no se puede bajar sin más: el ruido de
  escáner del control mide hasta 0,0011, igual que un renglón de letra
  chica.
- **El paso 2 de la cadena elige basura con el OSD acertando** (3 de 128 en
  el control): compara con la lectura de 0° por cantidad de palabras
  confiables, y la basura tiene más. En producción no se vio, porque esas
  páginas no reciben veredicto.

**Para decidir** (mantenedor):

1. El riesgo aceptado: dejarlo aceptado, ahora con la búsqueda hecha, o
   medir una señal sobre escaneos reales para adoptarla.
2. El renglón de costado: cerrarlo en esta versión, con una medición previa
   del costo sobre páginas en blanco con ruido, o registrarlo como
   limitación conocida.
3. El comparador del paso 2: pasarlo a confianza de página, mirando antes
   las páginas con texto solo en el margen (ADR-121), o dejarlo.

**Decidido el 2026-10-09.** (1) Medir una señal sobre escaneos reales. (2)
Medir el costo y cerrar el renglón de costado en esta versión. (3) Cambiar
el comparador en la misma enmienda. Las tres cosas pasan por M-O2.

### M-O2 — lo que falta medir antes de enmendar ADR-190

Mismo arnés que M-O1 (`osd-verdict`), con tres conjuntos nuevos. No cambia
producto.

**Las reglas candidatas.** Se evalúan fuera de línea, sobre las lecturas
medidas, sin tocar el producto.

- **RC — renglón de costado.** En una página entera sin veredicto, si la
  primera lectura no trae ninguna palabra y la tinta es mayor que cero, se
  prueban 90°, 180° y 270°, aunque la tinta quede debajo de
  `INK_PRESENT_RATIO`. El aviso de página ilegible sigue con el umbral de
  hoy: una hoja con ruido que no se lee en ningún ángulo no avisa.
- **CP — comparador.** En el paso 2 (y en el 3), entre las lecturas con
  alguna palabra confiable gana la de mayor confianza de página, y después
  la de más palabras confiables. Es la regla que ya usa la rama «sin
  veredicto».
- **SV — señal con veredicto.** Si hay veredicto y la lectura elegida tiene
  confianza de página menor que un umbral T, se prueban los ángulos que
  falten y se elige con CP. T se barre: 0,5, 0,6, 0,7, 0,8 y 0,85.

**Parte A — quién paga RC.** Las hojas en blanco con ruido de escáner.

- Conjunto nuevo «ruido»: una hoja A4 sin texto, con seis tipos de ruido
  (motas dispersas; una línea de sombra en un borde; dos perforaciones; una
  línea de doblez; motas más densas, hasta una tinta cercana a 0,0019; y
  motas con una sombra de borde), a 150 y 300 dpi, derecha y girada 90°. 24
  PDF.
- Por cada lectura en cada ángulo: palabras, palabras confiables, confianza
  de página y tiempo.
- Se quiere saber: cuántas lecturas de ruido traen alguna palabra confiable
  (texto inventado en una hoja vacía, y si de ahí sale alguna entidad);
  cuánto tardan tres lecturas más de una hoja casi vacía; y, sobre los datos
  de M-O1, qué páginas habría mandado RC a los cuatro ángulos y qué habría
  entregado.

**Parte B — SV sobre escaneos reales.** Documentos del mantenedor, por
variable de entorno.

- `ANONLY_REAL_DOC_R1`: un escaneo real de 20 páginas. Cada página es una
  observación, a su resolución nativa.
- `ANONLY_REAL_DOC_R2` a `R4`: tres documentos digitales (61 páginas en
  total), rasterizados a 150 dpi por el arnés como hace con los sintéticos.
  No son escaneos: dan la composición real de una página (encabezados,
  tablas, firmas) con píxeles limpios. Se informan aparte de R1.
- Cinco observaciones por página, como en M-O1: producción y un veredicto
  forzado a cada ángulo.
- **Privacidad.** Los registros de estas páginas no guardan palabras ni
  texto: solo cantidades, confianzas, tinta, ángulos, tiempos y hashes. Los
  identificadores son neutros (`R1-p07`). Nada de esto entra al repo ni a
  un informe, salvo agregados.
- No hay texto esperado. El ángulo de referencia de cada página es el que
  elige CP entre sus cuatro primeras lecturas; se informa en cuántas
  coincide con el veredicto natural.
- Se quiere saber: la confianza de página de una página real bien orientada
  (cuántas dispararían SV con cada T, que es el costo); la confianza de la
  basura en ángulo equivocado sobre una página real (cuántas se le escapan a
  cada T); y, con un veredicto equivocado forzado, en cuántas el producto de
  hoy entrega un ángulo distinto del de referencia sin avisar.

**Parte C — CP con texto en el margen.** La confianza de página no cuenta
las palabras que rescatan las pasadas de margen (ADR-121).

- Conjunto nuevo «margen», con el texto de siempre: M1, solo un sello
  vertical en el margen derecho, sin cuerpo; M2, la página completa de la
  campaña de ADR-190 más el sello; M3, dos renglones de cuerpo más el
  sello. Cuatro giros, 150 y 300 dpi. 24 PDF. El sello lleva un texto
  distinto del cuerpo, para saber cuál de los dos se recuperó.
- Lo que cuenta no es el ángulo elegido, sino si la lectura entregada trae
  los datos del cuerpo y los del sello.
- Se quiere saber: qué entrega la cadena de hoy; qué habría entregado con
  CP, en producción y con el veredicto correcto forzado; y, sobre los 128
  PDF de M-O1, cuántas de las 194 fugas cierra CP por sí solo y si rompe
  alguna de las que hoy se recuperan.

**Tamaño.** 48 PDF sintéticos y 81 páginas reales, a cinco observaciones:
645 observaciones, del orden de una hora y media.

**Salida.** Se suma al informe de M-O1 como secciones nuevas, con fecha.

**Después.** Con los números: enmienda de ADR-190 (RC y CP; SV solo si el
mantenedor la adopta), `OCR_Engine.md`, implementación en `ocr-engine`, y
la medición del después: M-O1 completa otra vez, los E2E de ADR-190, la
línea de base de calidad, y tiempo y memoria de la rama nueva.

### Resultado de M-O2 (2026-10-09, provisional)

645 de 645 observaciones. Detalle en el
[informe](../mediciones/ocr/Veredicto_De_Orientacion_Equivocado_2026-10-09.md),
sección «M-O2».

- **RC** recupera las 4 páginas de N1 y no cambia ninguna otra con texto.
  Lo pagan las hojas sin texto con ruido suelto: tres lecturas más, entre 1
  y 6 segundos por hoja. Ninguna lectura de ruido inventó texto (0 de 96).
- **CP solo no conviene**: no cambia nada en producción y, con un veredicto
  equivocado forzado, las fugas pasan de 194 a 212. Elige bien entre cuatro
  lecturas (128 de 128) y mal entre dos cuando ninguna es la correcta,
  porque la confianza de página no cuenta las palabras de las pasadas de
  margen.
- **SV con CP** baja esas fugas a 49 con T = 0,7 y a 22 con T = 0,8, y no
  dispara en ninguna de las 208 páginas bien orientadas medidas (128
  sintéticas y 80 reales). En las páginas reales, la lectura bien orientada
  va de 0,84 a 0,95 y la equivocada llega a 0,71.
- **Veredictos naturales equivocados**: 0 de 127 (48 sintéticos y 79
  reales).
- **Sin medir**: el costo de SV en escaneos de mala calidad, y la memoria.

**Decidido por el mantenedor el 2026-10-09**: antes de adoptar RC o SV se
mide el peor caso. Pidió además que la medición no descanse en documentos
sintéticos: ya le pasó que un resultado bueno sobre un sintético no se
repitiera con un documento real.

### M-O3 — el peor caso, con documentos reales

**Retoma en Codex (2026-10-09), terminada el 2026-10-10.** Se conservaron
las tres corridas válidas que dejó Claude y se completaron las otras 27 en
la misma campaña (`.measure/osd-verdict/campana-m-o3/`). Resultado: 30/30,
sin importaciones fallidas ni incoherencias, guardas de identidad y de
suspensión válidas. Sigue provisional por árbol sin commitear.

La evidencia de la retoma se registra en
[`Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md`](../mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md),
con medianas, rangos, máximos, picos posteriores a Ready y límites. El peor
caso cuesta 3,4–4,4 veces el tiempo. P2 cumple 3.000 MB con márgenes menores
que el ruido de 345 MB. C en P2 con ruido aumenta 444,6 MB en frío, con
rangos separados: no se cumple la condición previa de adoptar RC si no
mueve el pico. No cambia el texto ni entidades; los avisos extra de C
están inducidos por la tinta artificial del instrumento.

**Propuesta histórica, sustituida por la decisión del 2026-10-10:** RC + SV con umbral 0,8 + CP,
aceptando el peor caso medido y confirmando el costo de la regla real
después de implementarla. M-O2 refutó CP solo; la alternativa RC sola
conserva el riesgo del veredicto equivocado. La pregunta se presentó al
mantenedor el 2026-10-10. Todavía no se modificó el motor OCR.

**Respuesta del mantenedor:** pregunta si el tiempo extra es excesivo y
con qué frecuencia caería un documento real en el fallback de ruido; no
acepta todavía la propuesta. El recuento sobre producción de M-O2 da RC
elegible en 1/20 páginas de R1 y 0/61 de R2–R4. Es frecuencia del corpus,
no probabilidad general. M-O3 no aísla RC porque fuerza cuatro lecturas
también en páginas con texto. Se prepara la comparación A/RC, priorizada
tras interrumpir M-V1 por su preparación de conflictos, según
[`Costo_RC_Aislado_Protocolo_2026-10-10.md`](../ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md),
sin modificar fuentes de producto ni adoptar la regla. SV/CP sigue pendiente.

**Costo RC aislado, completado el 2026-10-10:** doce corridas válidas,
sin fallas ni cambios de texto, entidades o avisos; identidad y guarda
confirmadas al cierre, dist restaurados. R1 amplió una página de veinte:
Ready +0,394/1,022 s y M2 +19,7/−46,6 MB (dentro del ruido). P2N amplió
diez de sesenta: Ready +19,884/19,112 s y M2 +455,9/+404,8 MB, con rangos
separados. Presión del sistema no disponible. Estos datos no estiman
frecuencia real ni costo de SV. Después de estos resultados, el humano
aceptó RC y dejó SV/CP separado. Ver
[`Costo_RC_Aislado_2026-10-10.md`](../mediciones/ocr/Costo_RC_Aislado_2026-10-10.md).

**Adopción RC (2026-10-10).** «Sí, incorporar RC y decidir SV + CP después».
La enmienda de ADR-190 y `OCR_Engine.md` v1.18.0 incorpora solo la condición
de primera lectura vacía con tinta positiva, en página entera sin veredicto.
Mantiene ranking, avisos y DPI. La implementación debe recuperar los cuatro
N1 en el camino real, preservar controles/contratos y repetir calidad,
M-O1 y costo adoptado (ADR-218) antes de dar este punto por cerrado.
El orden y los criterios concretos están en
[`Recuperacion_RC_Validacion_2026-10-10.md`](../ocr/Recuperacion_RC_Validacion_2026-10-10.md).
El código y las siete pruebas están implementados: 229/229 pruebas OCR,
96,62% de cobertura de líneas y 86,83% de ramas; lint, tipos y formato
focalizados verdes. El discriminante falla con la regla anterior y vuelve
a verde al restaurar RC. El E2E N1 pasó las cuatro combinaciones naturales
con los mismos hashes de M-O1, DPI exactos de ADR-163 y DNI tapado en el
PDF final; también pasaron las seis regresiones ADR-190 en serie. La evidencia
está en `.measure/adr190-rc-n1-adr163-exact`. Calidad normativa y costo
adoptado se confirmaron después, según el protocolo de validación RC.
La caracterización M-O1 terminó después 700/700, sin cambios inesperados
en la proyección registrada; detalle en la validación RC. Sigue pendiente
la revisión del lote; no se marca cerrado el item 39.

**Pregunta.** Si todas las páginas de un escaneo se leen en los cuatro
ángulos, ¿cuánto suben el tiempo total y el pico de memoria, y cambia lo que
se entrega?

**Cómo se fuerza, sin tocar el producto.** El arnés reemplaza el resultado
de la detección de orientación por «sin veredicto». El producto entra a la
rama que ya existe y lee los cuatro ángulos en toda página con alguna
palabra confiable o con tinta, y elige con CP. Es el mismo trabajo que haría
SV disparando en todas las páginas.

**Brazos.**

- **A, control**: el producto tal cual.
- **A0, control del observador**: el mismo producto sin el observador de
  transporte, solo sobre P2. Permite informar cuánto mueve el instrumento
  el tiempo y la memoria del control A.
- **B, cuatro lecturas en todas**: «sin veredicto» forzado en todas las
  páginas, con la tinta medida.
- **C, hojas casi vacías**: además de «sin veredicto», la tinta informada
  sube al umbral cuando quedó debajo, para que las hojas con ruido suelto
  también hagan las cuatro lecturas. C conserva el DPI: al forzar ausencia
  de veredicto entra en la rama sin agrandado. Las 1.920 lecturas de C
  observadas conservaron escala 1. El costo incluye todas las páginas y
  hojas de tinta cero que RC no reintentaría; no aísla la regla candidata.

**Documentos.**

| Documento | Qué es | Brazos |
|---|---|---|
| R1 | El escaneo real, 20 páginas, a su resolución | A, B, C |
| R4 a 300 dpi | El digital real de 51 páginas, rasterizado: composición real, píxeles limpios | A, B |
| P2 | El perfil normativo de memoria (50 páginas escaneadas sintéticas). Es el que tiene techo, 3,0 GB (ADR-192) | A0, A, B |
| P2 con ruido | P2 con 10 hojas de ruido de M-O2 intercaladas, a 300 dpi | A, C |

Los reales van primero y son el resultado principal. P2 está porque el techo
de memoria se definió sobre él: sin P2 no hay con qué comparar.

**Qué se mide.** Con NER activo y nivel `medium`, como en M2.

- Pico de memoria M2 (ADR-146), en frío y en caliente, tres repeticiones.
- Tiempo desde la importación hasta `Ready`.
- Cantidad de reconocimientos por página.
- **Si cambia lo que se entrega.** Por página, entre A y B: cantidad de
  palabras, hash del texto entregado, cantidad de entidades por tipo y
  avisos de página ilegible. Sobre los reales es la prueba de que leer en
  cuatro ángulos no empeora una página que ya se leía bien. No se guarda
  texto.

**Qué decide.**

- Si B sobre P2 pasa el techo de 3,0 GB, SV no entra tal como está.
- Si B cambia el texto entregado de páginas reales bien orientadas, se
  informa cuántas y en qué sentido antes de seguir.
- Si C no mueve el pico ni cambia entregas, RC entra con el costo de tiempo
  ya medido.

**Límite que se declara.** Hay un solo escaneo real, y es de buena calidad.
El peor caso se fuerza justamente por eso: no depende de que la página se
lea mal. Lo que M-O3 no dice es cada cuánto SV dispararía en un escaneo
malo; para eso hacen falta escaneos malos reales.

**Salvedad del brazo C, identificada al retomar (2026-10-09).** Elevar la
tinta al umbral también cambia el criterio del aviso `unreadableInk`, no
solo cuántas lecturas se ejecutan. En la primera repetición de R1, C agrega
un aviso en la página casi vacía sin cambiar palabras, hash de texto ni
entidades. Ese aviso no demuestra una regresión de RC: la regla candidata
conserva el umbral medido para avisar, mientras que C informa una tinta
artificial. C sirve como cota de trabajo y memoria; su salida no sustituye
la validación de RC implementada con el criterio de aviso original. El
informe final separará estos avisos inducidos de cambios de texto o
entidades y no declarará equivalencia de producto por esa sola comparación.

## Frente 4 — Retirado del alcance (2026-10-11)

«Validar muestra» no se desarrolla. Se conserva la
[propuesta retirada](Validar_Muestra_Diseno_2026-10-09.md) y el
[informe M-V1](../mediciones/transversal/Validar_Muestra_Costo_Lectura_2026-10-10.md)
como antecedentes, sin tareas futuras ni consultas pendientes.

M-V1 quedó caracterizado: 36/36 registros, 30 flujos exitosos y seis lecturas
parciales de R4. El diagnóstico separado v2 confirmó `OCR_PAGE_FAILED` en
páginas 1 y 4, sin identificar causa raíz. El primer observador diagnóstico
inválido se conserva; v2 pasó controles sintéticos y auditoría de identidad,
guarda y privacidad. El informe conserva métodos, costos y limitaciones;
retirar la función no convierte las lecturas parciales en éxitos.

Los identificadores de los demás pasos y frentes se conservan para mantener
las referencias históricas. Se retiran del orden activo los pasos 4 y 7.

## Frente 5 — Gate del export: dos casos que faltan

Anotados en la revisión del lote del 2026-10-07. Es trabajo de tests; no
cambia producto.

- **Un renglón repintado.** Los casos del gate de ADR-148 usan el modo que
  tapa sin etiqueta, así que no acreditan un renglón donde el repintado de
  ADR-210 corre el resto del texto. Se agrega un caso con etiqueta más larga
  que el dato.
- **Restos tenues de tinta en un escaneo.** Alrededor de una etiqueta que
  entra en su caja queda el borde difuso de la tinta original. No es
  legible a la vista; falta medirlo contra el OCR del gate.

Si alguno de los dos muestra un dato legible, es un hallazgo de producto y
vuelve al mantenedor antes de tocar nada.

**Retoma del 2026-10-10:** las dos filas ya están integradas y pasaron por
separado, con sus controles `NO CUMPLE`; formato, lint y tipos focalizados
verdes. El gate dedicado terminó 23/23, sin fallos, salteados o flaky,
en serie y sin mediciones simultáneas. La revisión del lote sigue pendiente.
La evidencia auditada y el
estado integral se registran en
[Export_Gate_Ampliacion_2026-10-10.md](Export_Gate_Ampliacion_2026-10-10.md).

### Criterios de entrega al retomar (2026-10-09)

Los casos se agregan al spec que ejecuta el gate dedicado
(`tests/e2e/export-verification.spec.ts`), para que también se ejecuten en
CI. No alcanza con un E2E del preview ni con un archivo nuevo que el config
del gate no seleccione.

1. **Renglón desplazado:** fixture sintético con un identificador conocido,
   una etiqueta deliberadamente más larga que su caja y texto público
   vecino en el mismo renglón. Verificar que el camino real activa un
   desplazamiento positivo; después abrir el PDF final y exigir que el
   identificador y sus fragmentos prohibidos no aparezcan y que las
   palabras vecinas sigan presentes. Si no se activó el repintado, el caso
   no acredita ADR-210. No se cambia el producto para activarlo.
2. **Tinta tenue:** fixture escaneado sintético con suavizado conocido,
   identificador y vecinos, etiqueta que entra en su caja y OCR real del
   producto. El OCR independiente debe leer el identificador completo en
   el original y no sus fragmentos en el export. Si no puede leerlo en el
   original, la observación es inconclusa y falla como infraestructura.
3. **Controles discriminantes:** la salida sin tapar o deliberadamente mal
   tapada debe ser rechazada por el mismo verificador. No ajustar la
   comparación ni facilitar el fixture ante un rojo del producto. Se
   conservan los controles y las 21 filas vigentes de ADR-148/203; el
   mínimo de ejecución se actualiza cuando se concrete la ampliación.

La primera fila puede comprobar el desplazamiento con el mapa de geometría
vigente y con los píxeles, reutilizando el instrumento del E2E de ADR-210.
La verificación de seguridad siempre lee el PDF final. Los fixtures son
inventados; sus artefactos de diagnóstico pueden persistirse. Estas dos
filas no dependen de documentos reales ni declaran cubiertos todos los
escaneos borrosos.

**Fixtures concretados por el planificador (2026-10-09).** La primera fila
usa un PDF digital inventado, Helvetica 12, con el renglón «Consta DNI
38.471.629 PERICIA CONTABLE PUBLICA» y la etiqueta personalizada
`[IDENTIFICADOR PERSONAL 01]`. La segunda usa otro identificador inventado
y vecinos públicos, raster a 216 dpi, con suavizado gaussiano de sigma
1,2 píxeles, nivel negro 32, blanco 255, sin ruido y semilla 148203
(`adr148-faint-ink-v1`); la etiqueta `[DNI-01]` debe caber según los avances
medidos. La receta se fija antes de ejecutar. Si no produce un original
legible para el oráculo o activa el otro camino de repintado, se informa
como problema del instrumento y vuelve al planificador: no se ajusta para
esconder una falla del producto. El diagnóstico conserva cajas, avances,
desplazamiento y el anillo de píxeles del borde en original y export para
documentar dónde quedó tinta; el criterio de seguridad sigue siendo la
lectura del PDF final por el OCR independiente. Si ambas filas incorporan
sus controles en el mismo test, el mínimo del gate pasa de 21 a 23.

## Frente 6 — Publicación

- **Faltaba el changeset del lote del 2026-10-07.** Desde `v1.0.1` el único
  changeset agregado era el de «Avisos y novedades». Las notas de la versión
  tienen que decir que cambió la detección (`Roadmap_1.x.md` §2): emails
  leídos con `Q`, altura de las direcciones, conflicto que ya no descarta, y
  el repintado, que cambia el PDF exportado. **Redactado el 2026-10-08**
  (`.changeset/confianza-deteccion-y-export.md`), para que el mantenedor lo
  lea antes del commit.
- **La campaña de interacción tampoco tiene changeset** (PR #53, ADR-204 a
  207): entre otros cambios, la selección y la lupa sobre el PDF
  anonimizado. **Redactado al retomar el 2026-10-09**:
  `.changeset/interaccion-y-export-vigente.md`, a partir de su plan
  (`roadmap/interaccion/Mejoras_Interaccion_2026-10-05.md`). El changeset de
  Confianza también incluye ahora el patrón de direcciones de ADR-217.
- **La entrada de «Novedades»** de la versión (ADR-216, `RELEASING.md`).
- **Limitaciones conocidas**, con lo que este bloque cierre y lo que deje.
- **Número de versión: sin decidir.** El retiro de «Validar muestra» elimina
  el motivo de versión menor asociado a esa capacidad. El mantenedor decide
  el número según el alcance final y `Roadmap_1.x.md` §1 antes del tag.
- **Suite pesada antes del tag** (`Roadmap_1.x.md` §2): el bloque toca
  motores.

**Borrador de novedades al retomar (pendiente de implementación y revisión).**
Estas dos oraciones son una propuesta para la versión conjunta; ninguna
se agrega todavía a `releaseNotes.ts`. La entrada efectiva se escribe después de versionar,
con número y fecha reales, como exige `RELEASING.md`.

- **Mejora:** Mejoró la detección de direcciones, emails y renglones girados en escaneos; el mismo documento puede dar otro resultado.
- **Arreglo:** Las etiquetas largas conservan el resto del renglón en el PDF y la búsqueda sigue la posición visible del texto.

## Anexo — corpus de M-D2

Escrito por el planificador el 2026-10-08. Todo es inventado. Las oraciones
son datos: no se cambian ni se acomodan para que el resultado salga de una u
otra manera. Si una no se puede generar tal cual, es un hallazgo.

**Las tres escrituras.** Cada página lleva el relleno de antes, la oración y
el relleno de después, los mismos rellenos de M-D1. La página entera se
escribe de una de tres maneras:

- `n`: como está en la tabla;
- `M`: toda en mayúsculas, con sus tildes;
- `S`: toda en mayúsculas y sin tildes ni diéresis. La «Ñ» se conserva.

**Las partes de cada oración.** `vía` es la palabra de vía, si hay; `nombre`,
el nombre de la calle; `altura`, el número de puerta, si hay; `resto`, el
piso, departamento o cruce que sigue. En las escrituras `M` y `S` las partes
se transforman igual que la oración.

| Id | Oración | vía | nombre | altura | resto |
|---|---|---|---|---|---|
| K1-1 | La oficina funciona en Av. Corrientes 1980 de lunes a viernes. | Av. | Corrientes | 1980 | — |
| K1-2 | El consultorio se encuentra en avenida Pueyrredón 1999. | avenida | Pueyrredón | 1999 | — |
| K1-3 | Se constituyó domicilio procesal en la calle Tucumán 1650. | calle | Tucumán | 1650 | — |
| K1-4 | El depósito queda sobre Avda. Rivadavia 4520, a metros de la estación. | Avda. | Rivadavia | 4520 | — |
| K1-5 | La entrega se hizo en pasaje Rauch 742 por la tarde. | pasaje | Rauch | 742 | — |
| K1-6 | El taller está en Pje. Güemes 315, al fondo. | Pje. | Güemes | 315 | — |
| K1-7 | El comercio abrió sus puertas en boulevard Oroño 1260. | boulevard | Oroño | 1260 | — |
| K1-8 | La sucursal de Bv. Gálvez 2150 permanece cerrada. | Bv. | Gálvez | 2150 | — |
| K1-9 | El estudio atiende en diagonal Norte 615 por la mañana. | diagonal | Norte | 615 | — |
| K2-1 | El demandado, con domicilio en Maipú 1434 de esta ciudad, no contestó. | — | Maipú | 1434 | — |
| K2-2 | La actora, domiciliada en Sarmiento 742, promueve demanda. | — | Sarmiento | 742 | — |
| K2-3 | El imputado, domiciliado en Belgrano 1950, quedó detenido. | — | Belgrano | 1950 | — |
| K2-4 | La firma, con domicilio real en Lavalle 385, fue intimada. | — | Lavalle | 385 | — |
| K2-5 | El inmueble sito en Mitre 1985 fue embargado. | — | Mitre | 1985 | — |
| K2-6 | La finca sita en Alsina 455 fue tasada por el perito. | — | Alsina | 455 | — |
| K2-7 | Fija domicilio legal en Viamonte 867 para las notificaciones. | — | Viamonte | 867 | — |
| K3-1 | Vive en Av. Presidente Roque Sáenz Peña 1234 desde hace años. | Av. | Presidente Roque Sáenz Peña | 1234 | — |
| K3-2 | El local está en calle Hipólito Yrigoyen 2470. | calle | Hipólito Yrigoyen | 2470 | — |
| K3-3 | Con domicilio en General José de San Martín 856 de esta ciudad. | — | General José de San Martín | 856 | — |
| K3-4 | La escribanía funciona en avenida Juan Bautista Alberdi 3120. | avenida | Juan Bautista Alberdi | 3120 | — |
| K3-5 | Domiciliada en Doctor Luis Agote 98 de esta localidad. | — | Doctor Luis Agote | 98 | — |
| K3-6 | El club tiene su sede en calle Fray Justo Santa María de Oro 2745. | calle | Fray Justo Santa María de Oro | 2745 | — |
| K3-7 | Con domicilio en avenida del Mar 450 de esta ciudad. | avenida | del Mar | 450 | — |
| K4-1 | Constituyó domicilio en calle 25 de Mayo 350. | calle | 25 de Mayo | 350 | — |
| K4-2 | El banco está en Av. 9 de Julio 1200, frente a la plaza. | Av. | 9 de Julio | 1200 | — |
| K4-3 | La escuela funciona en calle 1° de Mayo 480. | calle | 1° de Mayo | 480 | — |
| K4-4 | Con domicilio en 12 de Octubre 1575 de esta ciudad. | — | 12 de Octubre | 1575 | — |
| K4-5 | El centro vecinal se reúne en avenida 2 de Abril 640. | avenida | 2 de Abril | 640 | — |
| K5-1 | Reside en calle 50 N° 889 de La Plata. | calle | 50 | 889 | — |
| K5-2 | El estudio se encuentra en calle 7 número 1240. | calle | 7 | 1240 | — |
| K5-3 | Con domicilio en calle 13 entre 44 y 45 de esa ciudad. | calle | 13 | — | entre 44 y 45 |
| K5-4 | La oficina está en diagonal 74 N° 1532. | diagonal | 74 | 1532 | — |
| K5-5 | El campo tiene entrada por ruta 205 kilómetro 54. | ruta | 205 | — | kilómetro 54 |
| K5-6 | Vive en Av. 44 Nº 2360, casa del fondo. | Av. | 44 | 2360 | — |
| K6-1 | El hecho ocurrió en Av. Corrientes y Maipú. | Av. | Corrientes | — | y Maipú |
| K6-2 | El choque fue en calle Lavalle esquina Callao. | calle | Lavalle | — | esquina Callao |
| K6-3 | Se lo vio por última vez en avenida Santa Fe entre Uruguay y Talcahuano. | avenida | Santa Fe | — | entre Uruguay y Talcahuano |
| K6-4 | El demandado tiene domicilio en calle Balcarce sin número. | calle | Balcarce | — | sin número |
| K6-5 | La parada está sobre Av. Colón al llegar a la rotonda. | Av. | Colón | — | — |
| K6-6 | Con domicilio en calle Urquiza s/n de la localidad de Tigre. | calle | Urquiza | — | s/n |
| K7-1 | Sito en calle Lavalle 385, piso 3, depto. B. | calle | Lavalle | 385 | piso 3, depto. B |
| K7-2 | Con domicilio en Av. Callao 1105, 2° piso, oficina 14. | Av. | Callao | 1105 | 2° piso, oficina 14 |
| K7-3 | Domiciliado en Viamonte 867 piso 4 departamento C. | — | Viamonte | 867 | piso 4 departamento C |
| K7-4 | Reside en avenida Belgrano 1950, PB, dpto. 2. | avenida | Belgrano | 1950 | PB, dpto. 2 |
| K7-5 | La actora vive en calle Alvear 1920 4° A. | calle | Alvear | 1920 | 4° A |
| K7-6 | Con domicilio en Maipú 1434, torre 2, piso 8, de esta ciudad. | — | Maipú | 1434 | torre 2, piso 8 |

**K8, trampas.** La palabra clave aparece y no hay ninguna dirección. No
tienen partes: se registra todo lo que la aplicación tape en la oración.

| Id | Oración |
|---|---|
| K8-1 | La calle estuvo cortada 3 horas por la marcha. |
| K8-2 | Los vecinos de la avenida reclamaron 15 veces. |
| K8-3 | El pasaje costó 4500 pesos según el recibo. |
| K8-4 | La ruta quedó habilitada después de 48 horas. |
| K8-5 | No se pudo establecer su domicilio en 2019 ni después. |
| K8-6 | El cambio de domicilio en 30 días fue rechazado. |
| K8-7 | Trabaja en la calle desde 1998 como vendedor. |
| K8-8 | La diagonal del terreno mide 120 metros. |
| K8-9 | Sobre la avenida circulaban 2 camiones. |

Son 55 oraciones base y 165 páginas.

**Qué se registra por página**, para cada parte (`vía`, `nombre`, `altura`,
`resto`):

- si quedó cubierta entera, en parte o nada por una ocurrencia de tipo
  dirección;
- si quedó cubierta por una ocurrencia de **otro** tipo, y cuál (un nombre
  de calle marcado como persona queda tapado igual);
- los valores de todas las ocurrencias que tocan la oración, con su tipo y
  su detector.

Y por página: si el texto que extrajo la aplicación es igual al escrito.

## Reglas para los sub-agentes de esta branch

Las de `CLAUDE.md` y `.claude/agents/implementador.md`. En particular:

- Uno a la vez, y los gates y las mediciones en modo síncrono.
- No editan `docs/` ni commitean. Entregan el resultado al planificador.
- Una medición no corre junto con otra suite pesada.
- Ningún dato, ruta ni nombre de un documento real entra al repo ni a un
  informe.
- Si un fixture necesita acomodarse para que algo pase, es un hallazgo y se
  reporta.
