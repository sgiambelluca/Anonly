<!-- CONTEXT: scope=adr | dependencias=core/PDF_Engine.md,core/Contracts.md,core/Orchestrator.md,ui/React_Client.md,adr/ADR-063-Bbox-De-Texto-Rotado.md,adr/ADR-049-Errores-Cruzando-Worker-Discriminacion-Por-Code.md,adr/ADR-126-Detectar-Nombres-No-Es-Una-Preferencia.md,adr/ADR-141-La-Geometria-Se-Entrega-En-La-Pagina-Que-Se-Ve.md | audiencia=humanos+IA | fase=11 -->

# ADR-140 — Una página rotada bloquea el documento

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-01 del plan de campaña de hardening (§2, §3.2).
- **Relacionado con**: ADR-063 §7 (la contradicción que lo destapó), ADR-126 §2 (fallar antes que devolver un resultado equivocado con cara de éxito), ADR-049 §3 (discriminar por `code`), **ADR-141** (la solución definitiva, que es la que retira este guard)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El desajuste está medido, y no es chico

Fixture sintético: `MediaBox [0 0 200 300]`, dos palabras en esquinas opuestas
(`ESQUINA-ALTA` en el origen de página `(40, 260)`, `ESQUINA-BAJA` en
`(40, 30)`), y cuatro PDFs que **solo** difieren en `/Rotate`. Para cada uno se
compara el origen que produce el motor hoy —`item.transform[4]`, y volteado con
`viewport.height - y`— contra el que dibuja el ráster —el mismo origen pasado
por `viewport.transform`, que es la matriz que el propio renderer de pdf.js
aplica antes de ejecutar el operator list:

| `/Rotate` | viewport | palabra | caja del motor | tinta del ráster | error |
|---|---|---|---|---|---|
| 0 | 200×300 | ESQUINA-ALTA | (40,0; 40,0) | (40,0; 40,0) | **0,0 pt** |
| 0 | 200×300 | ESQUINA-BAJA | (40,0; 270,0) | (40,0; 270,0) | **0,0 pt** |
| 90 | 300×200 | ESQUINA-ALTA | (40,0; **−60,0**) | (260,0; 40,0) | 241,7 pt |
| 90 | 300×200 | ESQUINA-BAJA | (40,0; 170,0) | (30,0; 40,0) | 130,4 pt |
| 180 | 200×300 | ESQUINA-ALTA | (40,0; 40,0) | (160,0; 260,0) | 250,6 pt |
| 180 | 200×300 | ESQUINA-BAJA | (40,0; 270,0) | (160,0; 30,0) | 268,3 pt |
| 270 | 300×200 | ESQUINA-ALTA | (40,0; **−60,0**) | (40,0; 160,0) | 220,0 pt |
| 270 | 300×200 | ESQUINA-BAJA | (40,0; 170,0) | (270,0; 160,0) | 230,2 pt |

Tres cosas que la tabla dice y conviene no perder:

1. En 0° el error es **exactamente cero**: lo que falla es la rotación, no la
   fórmula.
2. Los errores van de 130 a 268 pt en una página de 200×300 pt. No es una caja
   corrida unos milímetros: es una caja en otra parte de la hoja.
3. A 90° y 270° la caja cae **fuera de la página** (`y = −60`). Un reemplazo
   ahí no tapa nada y tampoco se ve raro: no se ve.

La causa es que `parsePage` mezcla dos marcos. `viewport.width`/`viewport.height`
—que van a `Page.width`/`Page.height`— salen de `getViewport({ scale: 1 })`, que
**ya aplicó** `/Rotate`; las posiciones salen de `item.transform`, que **no**.
El volteo `pageHeight - y` usa entonces la altura del marco equivocado.

### 2. La rotación se pregunta, no se busca

`pageProxy.rotate` la entrega ya resuelta y normalizada. Medido sobre el mismo
fixture: `/Rotate -90` → `270`, `/Rotate 450` → `90`, y `/Rotate 45` —que no es
múltiplo de 90 y por lo tanto es inválido según PDF 32000-1 §7.7.3.3— → `0`.

O sea: hereda del árbol de páginas, normaliza el signo y las vueltas enteras, y
descarta los valores inválidos. Buscar la cadena `/Rotate` en los bytes de la
página no hace nada de eso y falla justo en el caso que importa —la rotación
declarada en un ancestro—, que es como se rota un documento entero.

### 3. Por qué el documento entero y no la página

El OCR de una página sin texto nativo **no** está afectado: `rasterizePage`
(`render-engine/src/worker/kernel.ts`) también usa `getViewport({ scale })`, así
que el ráster que recibe Tesseract ya está rotado y las cajas que devuelve viven
en el mismo marco que `Page.width`/`Page.height`. Lo que está roto es
exclusivamente el camino de **texto nativo**.

Sería entonces tentador ignorar solo la página afectada y seguir. No:

- Un expediente con una hoja apaisada al final produciría un PDF exportado con
  todas sus hojas menos esa, y el usuario no tiene cómo saber cuál falta.
- Un documento "anonimizado" al que le falta una página es exactamente el
  resultado que ADR-126 §2 prohíbe producir: un archivo con cara de éxito y con
  datos adentro. La página rotada no es una página menos importante que las
  otras; es, típicamente, la que trae el sello o la carátula.

## Decisión

### 1. Código de error nuevo: `PDF_PAGE_ROTATED`

No se reutiliza `PDF_CORRUPTED`: el PDF **no** está corrupto, es un PDF válido
que esta versión no sabe procesar. Decir lo contrario en el mensaje le pide al
usuario que desconfíe de un archivo sano.

- `EngineErrorCode.PDF_PAGE_ROTATED`, con `engineId: "pdf"`, `retryable: false`.
- Clase `PdfPageRotatedError` en `pdf-engine/src/pdf.errors.ts`, junto a las
  otras cuatro.
- `details` permitidos: `documentId`, `pageIndex`, `rotation`. **Nada más**: ni
  texto de la página, ni nombre de archivo real, ni contraseña.
- Quien lo consume lo discrimina por `err.code`, nunca por
  `instanceof PdfPageRotatedError` — el error cruza el worker de PDF y la
  subclase no sobrevive (ADR-049 §3).

### 2. Dónde se dispara

En `parsePage`, con el `pageProxy` ya obtenido y **antes** de convertir items a
`Word`: si `pageProxy.rotate !== 0` y la página produce al menos una palabra
nativa (content stream o anotación, ADR-066 §1), se lanza.

La condición lleva las dos partes a propósito. Una página rotada **sin** texto
nativo va entera por OCR, cuyo camino es consistente (§3), y rechazarla
convertiría en inexportable a todo expediente escaneado cuyo scanner declaró
`/Rotate` — que es la mayoría. Esa consistencia es una lectura del código, no una
medición: **la tarea de implementación debe incluir el fixture de hoja escaneada
rotada y verificar el export**. Si ese test sale rojo, el guard se ensancha a
toda página rotada y se documenta acá.

### 3. Qué pasa aguas arriba

El error se propaga como cualquier fallo de extracción: aborta la extracción,
`PIPELINE_FAILED` con el error serializado, `stage: Failed`. El documento nunca
alcanza `Ready` y por lo tanto **no hay export posible**, que es la propiedad
que se busca.

En **tarea separada de UI**, `MESSAGE_BY_CODE` de
`apps/react-client/src/components/toolbar/pipelineErrorPresentation.ts` gana su
fila. El mensaje dice la limitación y una salida (ADR-087 §4: qué pasó y qué
hacer), sin afirmar que el archivo esté dañado y sin nombrar `/Rotate`.

### 4. El guard se retira por ángulo, no de golpe

Lo retira la implementación de ADR-141, y solo para los ángulos que su corpus
deja verificados de punta a punta (extracción, preview y **PDF exportado**). Si
queda una variante sin soporte, el guard se conserva para esa variante y queda
escrita acá.

## Consecuencias

**A favor**

- Un documento que hoy se exporta con los datos a la vista pasa a no exportarse.
  Es la única de las dos salidas que no produce una fuga silenciosa.
- El error es tipado y transporta la página y el ángulo: el usuario puede decir
  "la hoja 7" y el diagnóstico arranca de ahí.
- La condición no depende de heurísticas de bytes ni de que la rotación esté
  declarada en la página misma.

**En contra**

- **Documentos que hoy "funcionan" dejan de funcionar.** Un documento rotado con
  texto nativo cuyas entidades cayeran todas lejos de las cajas equivocadas se
  exportaba igual; ahora se rechaza. Es intencional: que un caso salga bien por
  suerte no es una garantía que se pueda ofrecer.
- Es un código de error nuevo, y por lo tanto toca `Contracts.md` §4,
  `04_Event_System.md`, el spec de PDF y la UI (R-19). El commit del contrato va
  solo, con este ADR.
- Mientras el guard exista, el corpus de H-03 para `/Rotate` verifica **rechazo**,
  no alineación. La fila de la matriz de H-03 cambia cuando ADR-141 aterriza.

**Lo que no toca**: el camino de OCR, `bbox.rotation` (que describe texto rotado
*dentro* de la página, ADR-063/066, y es un eje distinto de éste), ni la
geometría de ninguna página con `rotate === 0`.
