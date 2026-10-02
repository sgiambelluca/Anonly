<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,08_Security_Model.md,core/Render_Engine.md,core/Export_Engine.md,tests/e2e/README.md,adr/ADR-010-Testing-Strategy.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md | audiencia=humanos+IA | fase=11 -->

# ADR-148 — Un export se verifica leyendo el PDF exportado

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, sobre H-03 del plan de campaña de hardening (§5).
- **Relacionado con**: `08_Security_Model.md` (la propiedad "no recuperabilidad"), ADR-130 (el contenedor, que es donde corren los E2E), ADR-149 (los gates vacíos)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Lo que el gate de seguridad prueba hoy, y lo que no

`tests/security/security.test.ts` usa `pdf-lib` real y motores reales, pero el
proveedor de páginas entrega una constante:

> `// 1x1 PNG transparente, constante conocida — la única "imagen" que ve pdf-lib.`

Con eso prueba —bien— que Export **no copia** del original el texto, los
metadatos ni las estructuras que el spec exige eliminar: no puede filtrar por la
imagen porque nunca recibe una. Lo que no prueba, y no puede probar, es que
**Render haya tapado la tinta**. Un renderizador que dibujara los rectángulos de
reemplazo 20 pt a la izquierda pasaría este test entero.

No hay que reemplazar esos tests: la garantía estructural es útil y se conserva.
Falta la otra mitad.

### 2. La propiedad que falta enunciar

La propiedad de producto es: **el dato sensible no se lee en el PDF que el
usuario se lleva**. Eso no se demuestra sobre el `Document` en memoria, ni sobre
el canvas del preview, ni sobre el PNG intermedio del motor. Se demuestra
abriendo el archivo final y leyéndolo.

## Decisión

**Se agrega un gate que abre el PDF exportado, lo rasteriza y le pasa OCR.**

### 1. Dónde vive y con qué corre

Sobre la infraestructura que ya existe: Electron + Playwright contra el
contenedor empaquetado (ADR-130), motores reales, sin mocks de `renderPage`, de
OCR ni de la codificación del export. El fixture y el OCR de verificación son
**infraestructura de test**: no agregan red ni dependencias al runtime del Core.

El comando y su estado entran en la tabla canónica de gates
(`07_Performance_Strategy.md` §11.4) y en el workflow **en el mismo cambio** que
los crea. Ningún documento anuncia un comando que todavía no existe.

### 2. Dos pruebas, no una

- **Geometría**: se procesa con reemplazos **conocidos**, para aislar
  Render/Export de la detección.
- **Extremo a extremo**: se procesa desde la importación, para verificar que la
  detección además encontró lo que había que tapar.

Separadas a propósito: un detector que no encontró nada dejaría al renderizador
pareciendo correcto si las dos cosas se midieran juntas.

### 3. El control sin anonimizar es parte del gate

Antes de verificar el export se rasteriza la página **original** y se comprueba
que el OCR de prueba **sí lee** los identificadores objetivo. Si no los lee, el
caso es **inconcluso y falla como infraestructura de validación**. Un OCR que no
reconoce nada da "cero datos sensibles encontrados" sobre cualquier archivo,
incluido uno sin anonimizar.

### 4. Qué se exige del resultado

Que los objetivos **no aparezcan** y, además, que el documento **siga siendo un
documento**: cantidad de páginas, dimensiones y **texto vecino esperado
presente**. Un PDF vacío, en blanco o enteramente tapado no pasa el test aunque
no contenga datos sensibles — tapar todo no es anonimizar, es destruir.

### 5. Cómo se compara

Con reglas de normalización explícitas y documentadas **por fixture**:
mayúsculas, diacríticos, separadores de identificadores y escapes parciales
significativos. Nada de fuzzy matching tan laxo que confunda texto vecino con un
dato tapado, ni tan estricto que un `1`/`l` de OCR declare éxito.

### 6. El gate se prueba a sí mismo

Una salida sintética **deliberadamente sin tapar**, o con una caja corrida, tiene
que hacerlo fallar. Ese control se fabrica en el arnés de test: **no** se
modifica código de producción para producirlo.

### 7. Matriz mínima

| Caso | Qué tiene que pasar |
|---|---|
| PDF nativo sin rotación | objetivos en el original, ausentes en el export, vecinos conservados |
| Escaneo sintético | se ejercita el camino OCR real, no la capa textual del PDF de entrada |
| Página mixta | se cubren datos nativos y de región OCR |
| `/Rotate` 90/180/270 | mientras exista el guard de ADR-140: **rechazo explícito**; después de ADR-141: export alineado |
| Sello / identificador de causa | regresión específica de H-02, con datos ficticios |
| PNG/JPEG y escalas acordadas | no confundir artefacto de compresión con ausencia de texto |
| Modo de reemplazo | los modos que pintan distinto según spec; redacción sólida como control básico |

### 8. Higiene de datos

Fixtures **sintéticos**, con identificadores ficticios únicos y texto vecino no
sensible. Los artefactos de fallo se adjuntan **solo** del corpus sintético: el
modo de evaluación privada de documentos reales no guarda capturas, ni texto de
OCR, ni PDFs en CI. Se registran versión y hash del modelo de OCR y la
configuración de DPI/formato.

### 9. Lo que este gate no demuestra

Que un OCR no lea un dato es **evidencia**, no una demostración matemática de
ilegibilidad para un humano con lupa. El gate visual manual sigue existiendo, y
este ADR no lo reemplaza.

## Consecuencias

**A favor**

- La propiedad que el producto promete pasa a estar verificada sobre el artefacto
  que el usuario se lleva, no sobre una estructura intermedia.
- Los bugs que encuentre se arreglan por motor, en tareas independientes: el gate
  es un instrumento, no un parche.
- El control sin anonimizar y la prueba de sensibilidad cierran las dos formas
  clásicas de falso verde: OCR que no lee y verificador que no verifica.

**En contra**

- **Es caro**: rasterizar y pasar OCR sobre el export multiplica el tiempo de la
  suite. De ahí que la matriz sea mínima y que el corpus grande quede para
  corridas programadas o pre-release (ADR-147 §7).
- Un OCR de verificación tiene su propia tasa de error, y **puede producir
  falsos rojos**. Se prefiere ese riesgo al inverso; cada rojo se revisa mirando
  el artefacto adjunto.
- Mientras el guard de ADR-140 esté puesto, la fila de `/Rotate` verifica un
  rechazo, no una alineación. Es una fila que cambia de significado, y hay que
  cambiarla cuando ADR-141 aterrice.

**Lo que no toca**: los tests estructurales existentes —que se conservan tal
cual—, el runtime del Core, ni `Contracts.md`.
