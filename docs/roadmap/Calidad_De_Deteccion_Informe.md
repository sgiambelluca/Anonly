<!-- CONTEXT: scope=roadmap | dependencias=roadmap/Post_Hito10.8_Pendientes.md,core/OCR_Engine.md,core/Grouping_Engine.md,core/Regex_Engine.md,core/NER_Engine.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-058-Repintado-De-Linea.md | audiencia=humanos+IA | fase=10-cierre -->

# Informe — calidad de detección: qué falla hoy y con qué evidencia

**Fecha**: 2026-08-22. **Para**: sesión limpia que va a trabajar sobre la calidad de detección de los motores.

Este informe junta dos cosas que llegaron por caminos distintos y apuntan al mismo lado:

1. El **gate manual de ADR-058 §11 / ADR-086 §4**, que se corrió por primera vez sobre documentos con sello y con tablas y **no pasó**. Detalle completo en [`Post_Hito10.8_Pendientes.md` §23](./Post_Hito10.8_Pendientes.md).
2. Dos **reportes de campo del humano**, probando la herramienta sobre documentos reales: una tabla escaneada dada vuelta, y texto chico en una pericia real.

**La conclusión que los une**: los defectos que importan ya no están en el repintado ni en el layout. Están en **qué se detecta y qué no**, y la consecuencia es que el PDF exportado sigue conteniendo datos personales legibles. Es la promesa central del producto.

---

## Parte 1 — Lo que encontró el gate manual

Corrido sobre el **PDF exportado**, no sobre el preview (el preview dibuja anotaciones que el export no lleva; juzgar ahí da falso positivo). Fixtures sintéticos, fabricados para esto: `tests/fixtures/qa-tables-justified.pdf` y `qa-stamp.pdf`, generados por `tests/fixtures/generate.ts`.

### 1.1 Fugas de dato en el exportado — lo bloqueante

| # | Qué pasa | Por qué (hipótesis a verificar) |
|---|---|---|
| **A** | El **folio a 270°** ("Folio 214 — Juan Pérez") sale **en claro** | El texto se extrae pero el nombre no se detecta, o su bbox no llega al reemplazo. ADR-063 arregló el bbox de runs rotados y el DNI del sello a 90° **sí** se reemplaza — o sea que el problema no es la geometría en general |
| **B** | El **sello a 90°** reemplaza el DNI pero deja **"PERITO CARLOS LOPEZ"** en claro | Mayúsculas sin tilde. `CARLOS LOPEZ` no agrupa con `Carlos López` del cuerpo. Sospecha directa: la normalización de Grouping no está plegando acentos, o NER no reconoce nombres en caja alta |
| **C** | La **carátula** "Pérez, Juan c/ Empresa S.A." no se detecta | Orden invertido `Apellido, Nombre`, que es **la forma canónica de una carátula judicial**. Ni el patrón ni el NER la cubren |
| **D** | **OCR sobre el propio PDF exportado recupera "Pérez" y "Juan"** | Corolario de A/B/C: la fuga no es solo visible a ojo, es **legible por máquina** sobre el archivo que el usuario entrega |

**D es el que hay que tener presente al priorizar.** El export es 100 % imagen, así que la defensa "el texto no está en el PDF" es cierta y **no alcanza**: los píxeles dicen el nombre.

### 1.2 Cobertura del reemplazo

| # | Qué pasa |
|---|---|
| **E** | El reemplazo deja **el primer glifo del original visible** antes del token: se ve `Ju[HOMBRE 01]`, `B[DIRE 01]`, `DNI 3 [DNI 01]`. Es sistemático, no un caso de borde |

### 1.3 Lo que el gate iba a mirar (la costura)

| # | Qué pasa |
|---|---|
| **F** | El **texto justificado fragmenta entidades**: `Empresa S.A.` se detecta además como `Em` y `presa S.A`, dos grupos espurios |
| **G** | Los tokens se dibujan **más chicos y levantados** que la línea: se distinguen a simple vista, que es exactamente lo que el criterio del gate pedía que no pasara |
| **H** | La coma queda **huérfana** tras el token (`[DNI 01] ,`) y en la fila "Contacto" el token **desborda el borde de la celda** |

---

## Parte 2 — Reportes de campo

Los dos son del humano probando documentos reales. **No los reproduje yo**: lo que sigue es la observación tal como la contó, más el estado del código que la explicaría. Tratar el mecanismo como hipótesis hasta reproducirlo.

### 2.1 Tabla escaneada dada vuelta → OCR la lee horizontal y "detecta números"

**Observado**: una página escaneada de una tabla, rotada. En vez de tratar el texto como vertical, el OCR lo procesó como si fuera horizontal, y de esa lectura salieron **números detectados** — o sea, falsos positivos alimentados por texto basura.

**Estado del código, verificado hoy**:

- `ocr-engine/src/worker/kernel.ts:136` — `createWorker([...languages], undefined, { …paths })`. El segundo argumento es el **OEM** y va `undefined`.
- No hay **ninguna** llamada a `setParameters` en todo el motor. O sea: **PSM por defecto (3, "fully automatic page segmentation, but no OSD")**.
- `kernel.ts:354` — `recognize(image, {}, { blocks: true })`. El segundo argumento son las opciones de reconocimiento y va vacío.
- Tesseract nunca recibe `user_defined_dpi`.

**Por qué esto explica lo observado**: PSM 3 **no detecta orientación**. Tesseract tiene OSD (*orientation and script detection*) y hay que pedirlo — `PSM.AUTO_OSD` (1), o un `detect()` previo que devuelve el ángulo y permite rotar el raster antes de reconocer. Sin eso, una página cuyo **contenido** está a 90° se lee renglón por renglón en la dirección equivocada y produce secuencias de glifos sin sentido. Que de ahí salgan "números" es consistente: el `regex-engine` corre sobre ese texto y los patrones numéricos (DNI, CUIT, teléfono) son los que más fácil matchean ruido.

**Distinción que importa y conviene no confundir**:

- La rotación **declarada en el PDF** (`/Rotate` de la página) la aplica pdf.js sola al armar el viewport, y funciona.
- La rotación **del contenido dentro de un texto nativo** la resolvió **ADR-063** derivando la geometría de la matriz completa — por eso el DNI del sello a 90° del hallazgo B sí se reemplaza.
- La rotación **del contenido de un escaneo**, que es este caso, **no la cubre ninguna de las dos**: no hay matriz (es una imagen) y no hay `/Rotate` (el escáner no lo escribió). Solo OSD la puede ver.

Vale además revisar `Render_Engine.md` §13 caso 15, que según ADR-063 §7 promete una garantía de rotación a nivel de página que el motor no da.

### 2.2 Texto chico → el OCR no lo reconoce

**Observado**: en una pericia real, los textos muy chicos cuestan mucho.

**Estado del código**:

- `packages/anonymization-core/src/config.ts:96` — `ocr: { languages: ["spa", "eng"], dpi: 300 }`. **Fijo**, no adaptativo.
- `orchestrator.ts:1025` — `const scale = ctx.config.ocr.dpi / 72`, o sea el raster se arma a 300 DPI **nominales sobre el tamaño de página del PDF**.

**Por qué 300 puede no alcanzar, y por qué subirlo a ciegas no es la respuesta**:

- Tesseract quiere ~**20 px de altura de x** para andar cómodo. A 300 DPI, un cuerpo de 6-7 pt —normal en notas al pie, sellos y encabezados de tabla de un expediente— da del orden de 12-16 px de x-height: **régimen marginal**, que es exactamente donde "cuesta mucho" en vez de fallar limpio.
- **300 DPI nominales no crean detalle que el escaneo no tenga.** Si la pericia se escaneó a 150 DPI y se embebió, rasterizar la página a 300 no recupera nada: interpola. Antes de tocar el número hay que **medir la resolución real de la imagen embebida** y comparar contra el tamaño de página.
- Subir el DPI global **cuesta memoria y tiempo en toda página**: el propio código anota que "el `imageData` de una página A4 a 300 dpi son ~8 MB". A 600 son ~32 MB por página, por worker.

**Dirección más prometedora que el número global**: DPI **adaptativo** por página (derivado de la resolución real de la imagen embebida y del tamaño de página), y/o un **segundo pase** solo sobre las regiones donde el primero devolvió confianza baja. Las dos piden medición antes que código.

---

## Parte 3 — Qué haría una sesión limpia, y en qué orden

El orden es por **valor sobre la promesa del producto**, no por dificultad.

### Primero: reproducir, con fixture, antes de tocar nada

Ninguno de A/B/C/E/F tiene hoy un test que falle. Sin eso no hay forma de saber si un cambio arregla o mueve el problema. Los fixtures de `qa-*.pdf` ya existen y son el punto de partida; para 2.1 hace falta uno nuevo — una tabla rasterizada y rotada 90°, que se puede fabricar con el mismo camino que usa `tests/e2e/support/scannedPdf.ts`.

### Segundo: las tres fugas de detección (A, B, C)

Son las que rompen la promesa. Sospechas concretas, cada una barata de falsificar:

- **B** — probar si `normalizedValue` de Grouping pliega acentos y caja. Si no lo hace, es el arreglo de mejor relación valor/costo de toda la lista.
- **C** — `Apellido, Nombre` es un patrón, no un caso de NER. Puede vivir en `regex-engine` o como regla de Grouping. Ojo: cambiar detección toca precisión, así que conviene el dataset de referencia que `tests/fixtures/README.md` ya especifica y que nunca se construyó.
- **A** — verificar primero si el texto del folio **se extrae** (mirar `Word`s de la página) antes de asumir que es detección: si no se extrae, el problema está aguas arriba y es otro.

### Tercero: OSD para escaneos rotados (2.1)

Es aditivo y no cambia contratos: pedir OSD en el kernel y rotar el raster antes de reconocer. **Necesita ADR** si se decide que el ángulo detectado tiene que viajar en el evento o en `Word`; no lo necesita si se resuelve entero adentro del kernel de OCR.

Hay un efecto colateral que conviene medir: OSD cuesta tiempo por página. Si se corre siempre, encarece el 99 % de las páginas que están derechas.

### Cuarto: E (cobertura del reemplazo)

Es de `render-engine`/`export-engine`, no de detección, pero es barato y visible: el bbox del reemplazo empieza unos puntos a la derecha del primer glifo. Sospecha inmediata: un redondeo o un `x` de inicio tomado del segundo glifo del run.

### Quinto: la costura (F, G, H) y el DPI adaptativo (2.2)

F es de detección y probablemente se cae solo si se arregla cómo se agrupan runs de una misma línea. G y H son de repintado. El DPI adaptativo pide medición primero.

---

## Lo que este informe **no** dice

- **No dice que los fixtures sean suficientes.** Son sintéticos: reproducen el régimen (justificado real, celdas apretadas, rotación a 90°/270°) pero no la suciedad de un expediente real —kerning por par de glifos, fuentes subseteadas, sellos rasterizados—. Sirven para decidir que **hay** defectos; no para declarar que no hay otros.
- **No dice que los mecanismos de la Parte 2 estén confirmados.** Son hipótesis derivadas de leer el código, sobre observaciones que no reproduje.
- **No propone arreglos concretos de código.** Varios de estos piden decisión (ADR) antes que implementación, y elegir mal el orden acá cuesta caro: tocar detección sin dataset de referencia mueve precisión y recall sin que nadie se entere.

## Punteros

- Hallazgos del gate, completos: [`Post_Hito10.8_Pendientes.md` §23](./Post_Hito10.8_Pendientes.md)
- Fixtures y qué ejercita cada uno: [`tests/fixtures/README.md`](../../tests/fixtures/README.md)
- Estado del hito y qué falta para cerrarlo: [`MVP.md` §4](./MVP.md)
- Rotación de texto nativo y lo que dejó abierto: `adr/ADR-063`, §6 (solapamiento) y §7 (rotación de página)
- Dataset de referencia, especificado y nunca construido: [`tests/fixtures/README.md`](../../tests/fixtures/README.md), sección "Dataset de referencia"
