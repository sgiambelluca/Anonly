<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/Roadmap_1.x.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-140-Una-Pagina-Rotada-Bloquea-El-Documento.md,adr/ADR-141-La-Geometria-Se-Entrega-En-La-Pagina-Que-Se-Ve.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,architecture/07_Performance_Strategy.md,architecture/08_Security_Model.md,core/Contracts.md,core/Render_Engine.md,core/Export_Engine.md,tests/e2e/README.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,adr/ADR-203-El-Gate-De-Export-Cubre-La-Politica-OCR-Vigente.md | audiencia=humanos+IA | fase=12 -->

# Gate del PDF exportado — plan de implementación de ADR-148

**Cierre de alcance autorizado, 2026-10-05 (ADR-203):** validar ADR-148
con la política vigente de 100 pt. Mixed del gate versionado como
`mixed-eligible-v2-300x125`; conservar el original `mixed-small-v1-300x56`
en caracterización y documentar su fuga. Runtime experimental de 25 pt
retirado del workspace; snapshots/evidencia intactos. Implementación de
esta corrección y gate completo cerrados: **21/21, cero salteados, R-16
verde y Sol APPROVED local**. **CI/macOS 21/21 y corrida completa success**
en [run 37383499951](https://github.com/sgiambelluca/Anonly/actions/runs/37383499951).
La matriz y el oráculo no
se aflojan. Ver [ADR-203](../../adr/ADR-203-El-Gate-De-Export-Cubre-La-Politica-OCR-Vigente.md).
Evidencia final y revisión en
[la ronda de cierre](ADR148_Cierre_ADR203_2026-10-05.md). Los resultados
rojos siguientes describen la primera campaña, anterior a esa corrección.

**Auditoría inicial del planificador: 2026-10-05.** ADR-148 está aceptado, pero no
tenía un spec ejecutable: faltaban corpus, comparación, resolución de la
rotación actual y mínimo obligatorio del runner. Este plan cierra esos
vacíos. **Implementación entregada, sin aprobar.** La primera corrida Windows
dio 20/21, cero salteados. Las correcciones del arnés quedaron verificadas;
solo persiste la incompatibilidad del corpus mixto con la política OCR
vigente, detallada abajo. La
[primera revisión](ADR148_Revision_2026-10-05.md) es histórica. CI/macOS
todavía no verificada; la tabla canónica registra el comando ya existente.

> **Revisión Sol 6.1: REJECTED.** El fixture mixed de 300 × 56 pt
> contradice el mínimo de 100 pt por lado de ADR-065: es un error de este
> plan, no evidencia de defecto de wiring. El humano decidió investigar
> imágenes pequeñas en una tarea independiente con calidad y memoria,
> sin elegir todavía un umbral nuevo. La fila mixed queda bloqueada;
> formato, cleanup y espera fija quedaron corregidos y verificados por
> el mismo revisor. El veredicto global sigue REJECTED solo por mixed. Ver
> [la revisión](ADR148_Revision_Sol61_2026-10-05.md) y
> [el plan de investigación](../ocr/Regiones_Pequenas_Investigacion_Plan.md).

## 1. Alcance y límites

Primer trabajo de `Roadmap_1.x.md` §3. Es infraestructura de tests: no cambia
el producto, los contratos, la detección ni las dependencias. No implementa
«Validar muestra». Conserva los tests estructurales de `tests/security/`.

Dependencias permitidas: las versiones instaladas y fijadas por
`pnpm-lock.yaml` de Playwright, pdf-lib, pdfjs-dist y tesseract.js. Reutilizar
el shell, `tests/e2e/support/electronApp.ts`, `scannedPdf.ts` y los assets de
`assets.lock.json`. El OCR verificador es una instancia independiente del
OCR del producto; no consume sus palabras, bboxes, confianza ni resultados.

## 2. Corpus reproducible

Generador de test en `tests/e2e/support/exportVerificationFixtures.ts`, con
pdf-lib y Helvetica. Nada proviene de documentos reales. Cada descriptor
declara ID, páginas, dimensiones, texto, objetivos, vecinos, rectángulos
PDF de origen y reglas de comparación. No usar `qa-stamp.pdf` como corpus:
generar el sello ficticio con el contenido de esta sección.

- Página base A4: 595 × 842 pt, fondo blanco, tinta negra, Helvetica 18 pt,
  margen de 36 pt y distancia entre renglones de 28 pt. Diez renglones
  neutrales `Contenido publico de prueba linea A` a `... linea J` aportan
  densidad de orientación. Vecinos obligatorios: `INICIO PUBLICO` y
  `CIERRE PUBLICO`, antes y después del bloque sensible, fuera de las cajas.
- `native`: dos páginas; en la primera, `DNI 34.567.891` y
  `DNI 62.938.475`, en renglones separados. La segunda conserva
  `SEGUNDA PAGINA PUBLICA` y relleno neutral, sin objetivos. Así se detecta
  también una página omitida, duplicada o vacía.
- `scan`: la primera página de `native`, rasterizada a **288 dpi**
  (`scale = 4`) y embebida como PNG, sin capa de texto.
- `mixed`: una página con `DNI 34.567.891` nativo y una imagen PNG de
  `DNI 62.938.475`, con su vecino `REGION PUBLICA`, en una región separada
  que no cruza texto nativo. **ADR-203: `mixed-eligible-v2-300x125`**,
  imagen 300 × 125 pt en x=40/y=220, fuente rasterizada del mismo tamaño,
  Helvetica 18, texto x=8/y=18, sin escalar glifos. Mantener cajas y relleno;
  el generador debe afirmar que el segundo objetivo no está en la capa
  textual y el primero sí. El camino real de OCR regional se verifica
  observando `OCR_PAGE_FINISHED`, además de la detección de ambos objetivos.
  Registrar `corpusRevision` en descriptor y evidencia. La variante pequeña
  histórica `mixed-small-v1-300x56` conserva imagen x=40/y=248 y todos sus
  datos originales en un builder de caracterización separado. Los arneses
  de investigación y auditoría offline continúan usando esa variante.
- `stamp`: una página con un sello ficticio horizontal en el margen:
  `DNI 34.567.891` y `CAUSA FICTICIA 72938461`, lejos del cuerpo;
  vecino `SELLO PUBLICO`. El DNI debe detectarse automáticamente. El número
  de causa es objetivo **solo de geometría**: no existe patrón de expediente
  en el producto y este gate no lo agrega. El E2E conserva esa línea como
  contenido permitido y verifica la redacción del DNI.
- Rotaciones: copias de `native` y `scan` con `/Rotate` 90, 180 y 270,
  aplicado **después** de construir el PDF. No sustituir `/Rotate` por un
  giro físico de los píxeles. Los vecinos del escaneo se leen en la misma
  orientación de lectura conocida que los objetivos.

Calcular cada caja sensible desde `font.widthOfTextAtSize` y las posiciones
del generador: excluir el prefijo `DNI `, incluir la altura completa del
glifo con 2 pt de margen. Para la imagen mixta, transformar desde su tamaño
de origen a su colocación en puntos. Convertir a coordenadas de página
presentada con el viewport real de pdf.js (`convertToViewportPoint`), sin
usar geometría del detector ni fórmulas particulares por ángulo.

El generador falla si una caja sale de página o invade un vecino. Se fija
el contenido antes de medir. No aumentar densidad, fuente, margen o caja
para acomodar un rojo del producto: informar el hallazgo al planificador.
La revisión del corpus en ADR-203 es una corrección explícita del plan
incompatible, decidida antes de código; no una facilitación del implementador.
No acredita eliminación de datos en la variante pequeña excluida por política.

## 3. Dos caminos separados

**Geometría:** usar los motores reales expuestos por `__anonlyCore.engines`
en el build `VITE_E2E=1`. Cargar los bytes fuente con
`RenderEngine.loadDocument`, y armar `Document`, grupos y reemplazos de
test desde el manifiesto, sin consultar ni ejecutar la detección. Llamar
`ExportEngine.export` con un `RenderPageProvider` que llama al
`RenderEngine.renderPage` real, `kind: "anonymized"`, `mode: "full"`,
`scale = dpi / 72` y formato de la fila. Su resultado `encoded` se
entrega intacto al ensamblador. No reemplazar funciones ni pools, ni
fabricar la imagen del resultado positivo. Los `EngineContext` usan bus
real, configuración acorde a la fila y cancelación propia del test.
`groups` y `Replacement` deben respetar `Contracts.md` y las interfaces
existentes; el harness no publica tipos nuevos del Core.

En esta prueba los valores conocidos son: `redact` → cadena vacía;
`placeholder` → `[DNI 01]` / `[DNI 02]`; `mask` → `XX.XXX.XXX`;
`synthetic` → `79.406.215` / `85.170.269`. Para la causa usar `redact`.
El test no evalúa al sintetizador. Guardar el buffer PDF devuelto y leerlo
de nuevo desde disco antes de verificarlo. Los reemplazos son entradas
conocidas, nunca un parche sobre el PDF de salida.

**Extremo a extremo:** importar con el control de archivo de la app,
esperar grupos para **cada** DNI del manifiesto, elegir `redact` para todos
los objetivos y exportar por el diálogo. Capturar la descarga completada
con `captureDownload`, y reabrir sus bytes. No agregar entidades a mano,
inyectar grupos ni corregir cajas en este camino. Registrar que hubo OCR
real en `scan` y `mixed`, sin usarlo como oráculo de ausencia. NER se
desactiva mediante el override existente: este corpus evalúa identificadores
y no fija un umbral nuevo de calidad de NER.

En ambos caminos: perfil Intermedio y OCR del producto en español,
leyenda apagada, metadatos originales excluidos, sin páginas cubiertas
por ADR-190. Destruir documentos, trabajadores, canvas y blob URLs en
`finally`, también cuando un control o una aserción falla.

## 4. Oráculo independiente sobre archivos

Rasterizar **todas** las páginas del original y del PDF final con pdf.js
independiente en el renderer Electron, fondo blanco, **288 dpi**. Este
valor evita sobrepasar `MAX_RENDER_SCALE = 4` en el producto y deja explícita
la resolución de verificación. No verificar el canvas del preview ni el
PNG que devuelve Render. Solo los bytes fuente y los bytes finales.

OCR verificador: tesseract.js instalado, `spa`, OEM LSTM (1), PSM auto (3),
sin whitelist de caracteres ni filtro de confianza, `cacheMethod: "none"`,
worker/core/lang paths locales y `gzip: true`. Puede correr en Node sobre
los PNG obtenidos del renderer: no necesita cambiar la CSP ni el bundle
de producción. En ese caso, registrar ruta, versión y hash del worker Node
y del core instalado que realmente ejecuta, ligados a `pnpm-lock.yaml`;
comparar el traineddata español ejecutado contra `assets.lock.json`. Los
hashes del worker de navegador son assets del producto y no acreditan el
worker Node independiente. En páginas con `/Rotate`, orientar el bitmap para leerlo
según el ángulo **conocido del fixture**, tanto en fuente como en salida;
no deducir el ángulo del resultado del OCR del producto. Se conserva la
verificación de dimensiones de la página presentada antes de ese giro.

Antes de examinar una salida, exigir que en su **original** se leen todos
los objetivos completos y todos los vecinos de cada página. Si falta algo,
el caso falla como `INCONCLUSO` (infraestructura), nunca pasa ni se saltea.
En la salida exigir:

1. Parseo y rasterización de cada página sin error, cantidad y orden
   previstos; dimensiones presentadas iguales a la fuente, tolerancia de
   0,01 pt. Un PDF exportado no tiene por qué conservar `/Rotate`.
2. Todos los vecinos esperados en su página, incluida la segunda página.
3. Ningún objetivo completo ni fragmento prohibido en ninguna página.
   No limitar la búsqueda a la caja esperada: una caja corrida puede dejar
   texto visible fuera de ella.

**Normalización por fixture:** NFKD, quitar marcas diacríticas, uppercase,
unificar espacios. Para DNI/causa quitar espacios, puntos, guiones y barras
entre caracteres del identificador. Equiparar `I`, `L`, `|` a `1`, `O` a
`0`, `S` a `5` y `B` a `8` **solo** en candidatos numéricos; nunca en todo
el documento ni en vecinos. Un candidato es una secuencia de esos dígitos
y confusables, con los separadores permitidos; no concatenar números de
renglones distintos. La segmentación puede usar líneas del OCR verificador.

Objetivos normalizados: `34567891`, `62938475`, `72938461` (este último solo
en geometría del sello). Para cada objetivo prohibir también sus prefijos
y sufijos de **cuatro dígitos** (`3456`/`7891`, `6293`/`8475`,
`7293`/`8461`), como subcadenas de candidatos numéricos. Es un criterio
conservador y acotado al corpus, no una garantía para cualquier fragmento.
Los reemplazos conocidos y vecinos no contienen esos fragmentos; comprobarlo
en el generador. No prohibir números nuevos ni textos `DNI` en general.
Los vecinos se comparan como frases normalizadas, sin distancia de edición.

## 5. Matriz mínima obligatoria

Cada fila expandida es un test Playwright independiente, con nombre que
incluya ID, camino, modo, formato y DPI. No opt-in, skips ni fixme.

| Corpus | Camino | Modo | Formato / DPI de export | Tests |
|---|---|---|---|---|
| native | geometría | redact, placeholder, mask, synthetic | JPEG 150, calidad 0,85 | 4 |
| native | geometría | redact | PNG 150, PNG 288, JPEG 288 calidad 0,85 | 3 |
| scan, mixed, stamp | geometría | redact | JPEG 150, calidad 0,85 | 3 |
| native, scan, mixed, stamp | E2E | redact | JPEG 150, calidad 0,85 | 4 |
| native con /Rotate 90/180/270 | E2E | no llega a export | rechazo explícito | 3 |
| scan con /Rotate 90/180/270 | E2E | redact | JPEG 150, calidad 0,85 | 3 |
| controles del oráculo sobre PDF final | infraestructura | ver §6 | misma rasterización y OCR | 1 |

**Total mínimo: 21 tests ejecutados y cero salteados.** Matriz por ejes,
no producto cartesiano; no promete cubrir los 13 tipos ni todas las
compresiones. Los valores 150 y 288 dpi son configuraciones de test, no
un cambio del default de 150 ni de la opción de 300 del producto.

**Rotación vigente:** `pdf.engine.ts` todavía lanza `PDF_PAGE_ROTATED` si
`pageProxy.rotate !== 0` y hay palabras nativas, pese a la composición de
ADR-141 ya implementada. Afirmar ese código observando `PIPELINE_FAILED`,
mensaje de rechazo y ausencia de descarga; no retirar el guard. Un escaneo
sin capa nativa no entra al guard y debe exportarse. Cuando se retire el
guard mediante otra tarea, actualizar estas tres filas a export alineado.

## 6. Controles que evitan falsos verdes

El test de infraestructura produce PDFs sintéticos con pdf-lib desde el
original rasterizado, **sin tocar motores ni código de producción**:

- Copia imagen sin tapar: el mismo verificador debe rechazarla por fuga.
- Caja negra desplazada 80 pt: debe rechazarla por fuga.
- Página totalmente blanca y página totalmente negra: debe rechazar ambas
  por pérdida de vecinos.
- Página faltante del `native`: rechazo por integridad.

Debe comprobar la **causa** de cada rechazo; un error de OCR o un timeout
no demuestra sensibilidad. Unit tests del comparador cubren separadores,
confusables, fragmentos, contenido permitido y vecinos. Un control original
con OCR vacío debe generar `INCONCLUSO`. Los controles se incluyen también
en el paso local de validación; no contar un test fallado a propósito como
verde del runner: las aserciones del test esperan el rechazo del verificador.

## 7. Runner, CI y evidencia

Implementar `tests/e2e/export-verification.spec.ts` y una configuración
`playwright.export-verification.config.ts`: solo ese spec, workers 1,
fullyParallel false, retries 0, forbidOnly en CI, timeout 300 s por test,
reporters list y JSON con salida en `test-results/export-verification.json`.
La configuración admite el override de ruta JSON por variable de entorno
existente de Playwright. El comando futuro `test:export-verification` debe
mirrorear assets, construir renderer con `VITE_E2E=1`, construir shell,
ejecutar el spec y comprobar el reporte con `assert-min-tests.mjs`
(`--format playwright --min 21`), también localmente. Implementar ese
script sin operadores dependientes de Bash, y sin aceptar filtros que
reduzcan el mínimo; los diagnósticos por archivo pueden usar Playwright.

Evitar ejecución duplicada: excluir este spec de la configuración E2E
general al agregar el gate dedicado. Reutilizar soporte en `tests/e2e/`;
los tests unitarios del comparador pueden vivir en `tests/security/`.
Incluirlos en el typecheck existente y añadir cobertura ≥85 % del módulo
puro nuevo en Vitest. No modificar tsconfig base.

Agregar job `Export verification` en `ci.yml`, macOS, máximo 45 minutos,
mismo filtro de eventos que E2E (ADR-199): pushes a main/develop,
PR hacia main y workflow_dispatch. Corre el comando completo, sin
continue-on-error ni verde por ausencia de archivos. El check agregador
`E2E (Playwright)` debe depender también de este job y exigir su éxito:
así queda cubierto por el check requerido actual sin cambiar la protección
remota. No modificar la política de gates rápidos para PR a develop.

El mismo cambio que crea el comando debe agregar su fila a la tabla
canónica de `07_Performance_Strategy.md` §11.4 y actualizar la explicación
del check E2E. **No agregar el comando ni anunciarlo activo antes.**
Los docs los edita el planificador cuando el implementador entregue el
código; el implementador no edita `docs/`.

Reporte sintético: SHA-256 de fuente y salida, tamaños, dimensiones,
fixture y reglas, versiones de paquetes, DPI/formato/calidad, hashes reales
de traineddata/worker/core comparados contra `assets.lock.json`, y resultado
por página. Diferenciar `NO CUMPLE` de `INCONCLUSO`; ambos dan exit no cero.
Adjuntar PDFs, PNG y texto OCR **solo** de estos fixtures sintéticos, con
retención CI de 7 días y upload incluso al fallar. El comando no acepta
rutas `ANONLY_REAL_DOC_*` ni corpus privado. Nunca cargar documentos reales
en una corrida que guarda traces, capturas, OCR o PDFs.

## 8. Orden y cierre

**Ronda de cierre ADR-203:** primero Luna restaura 100 pt y sus pruebas de
frontera normativas; separa ambos mixed versionados, actualiza sus consumidores
y ejecuta el comando completo Windows más checks scoped. Luego el mismo Sol
revisa por lote y confirma R-16 global una vez; conserva las corridas anteriores
y no vuelve a medir ADR-202. Si falta ejecución remota, código y revisión
deben estar concretos antes de pedir autorización explícita de commit/push.
No ejecutar dispatch sobre un ref viejo para presentarlo como prueba del cambio.

1. Generador y manifiestos, comparador puro y sus tests.
2. Rasterizador/OCR independiente y controles discriminantes.
3. Camino de geometría y E2E, completar las 21 filas.
4. Runner, mínimo, CI y agregado E2E. El planificador sincroniza tabla,
   ADR y roadmap en esta entrega, sin atribuir éxito a CI no ejecutada.
5. Correr el gate completo en Windows nativo, y scoped lint/typecheck/tests.
   El revisor confirma una vez el subset completo de R-16. CI/macOS se
   informa por separado; una corrida local no lo acredita.

Sin commits, push, release ni cambios en motores sin autorización propia.
Si aparece una fuga, no aflojar el oráculo ni tocar producto en esta tarea:
informar fixture, camino y evidencia sintética, para planificar el arreglo
por motor. Una fila pendiente o roja no permite declarar activo el gate.

**Criterio de entrega:** 21 tests ejecutados, cero salteados, controles con
la causa esperada, verificación real de bytes finales, integración CI y
documentación sincronizada; limitación de OCR/manual de ADR-148 conservada.
