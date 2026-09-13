<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,architecture/03_Data_Model.md,core/PDF_Engine.md,core/Orchestrator.md,core/OCR_Engine.md,adr/ADR-064-Palabras-De-OCR-En-Puntos.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,roadmap/Optimizacion_De_Memoria_Plan.md | audiencia=humanos+IA | fase=11 -->

# ADR-163 — El DPI de OCR no supera al ráster fuente

- **Estado**: Accepted
- **Fecha**: 2026-09-13
- **Decidido por**: El planificador, al cerrar la especificación de T-6a.
- **Parte de**: Hito 11 — campaña de memoria, T-6a

> **Implementada el 2026-09-13** en tres scopes: contrato compartido,
> `pdf-engine` y façade/Orchestrator. Pasaron 508/508 tests de los scopes
> afectados, 2157/2157 tests globales, 311/311 contract tests, typecheck global,
> ESLint scoped y Prettier. La medición P2 queda como T-6b y no condiciona el
> cierre funcional.

## Contexto

T-6a estaba autorizada pero no era implementable: decía
`min(dpi configurado, resolución nativa)` sin definir quién obtiene la segunda,
cómo se representa, qué ocurre con varias imágenes o cómo se mantiene el `dpi`
de OCR sincronizado con la escala real. Esa última omisión es crítica: ADR-064
usa `dpi` para convertir las cajas de Tesseract de píxeles a puntos; rasterizar
a una escala y enviar otra mueve la anonimización.

`pdf-engine` ya recorre el operator list y la CTM de cada imagen. Es el único
lugar que puede convertir dimensiones nativas de píxel + tamaño dibujado en un
límite seguro. El Orchestrator es el único lugar que puede aplicar ese límite al
descriptor, la reserva de memoria y la llamada a Render sin importar motores
entre sí.

## Decisión

### 1. `Page.ocrDpiCap` es un contrato opcional y conservador

Se agrega a `Page`:

```ts
readonly ocrDpiCap?: number;
```

Es el menor DPI entero que preserva los píxeles nativos de una página que el
PDF Engine pudo demostrar que es un único ráster. Ausente significa “sin prueba”
y obliga a conservar el DPI configurado. No se reutiliza `Page.dpi`: ese campo
describe una página ya OCR-eada, no la fuente previa.

El campo solo se puebla cuando se cumplen todas estas condiciones:

1. `requiresOCR === true`;
2. hay exactamente una operación de imagen raster (`paintImageXObject` o
   `paintInlineImageXObject`);
3. la operación informa ancho y alto nativos, finitos y positivos;
4. los dos ejes de su CTM tienen longitud finita y positiva;
5. no hay otra operación que pinte texto, trazos, rellenos, sombreado, máscara
   u otra imagen.

Ante una forma desconocida o ambigua, el campo queda ausente. T-6a no intenta
optimizar OCR por región: esas páginas tienen texto nativo y no cumplen el
primer punto.

`OPS.dependency` es estructural y **no pinta**: debe aceptarse, porque pdf.js lo
emite normalmente antes de un XObject. En `paintImageXObject`, las dimensiones
son los argumentos 1/2; en `paintInlineImageXObject`, son `width`/`height` del
objeto del argumento 0. Las dos formas requieren narrowing explícito.

### 2. Fórmula exacta

Para CTM `[a,b,c,d,e,f]`, ancho nativo `wpx` y alto nativo `hpx`:

```text
scaleX = wpx / hypot(a, b)
scaleY = hpx / hypot(c, d)
ocrDpiCap = ceil(72 * max(scaleX, scaleY))
```

El máximo evita bajar detalle en el eje de mayor densidad; `ceil` evita que el
redondeo haga *downsample*. La traslación no participa y una rotación recta no
cambia las longitudes. No hay umbral de cobertura ni tolerancia geométrica.

### 3. El Orchestrator deriva una pareja inseparable por request

Para cada página completa:

```text
effectiveDpi = min(config.ocr.dpi, page.ocrDpiCap ?? config.ocr.dpi)
scale = effectiveDpi / 72
```

La expresión presupone el invariante público (`ocrDpiCap` entero positivo).
Como el decoder del boundary conserva deliberadamente una validación superficial,
el Orchestrator aplica además una guarda defensiva: un valor no numérico, no
finito o `<= 0` se trata como campo ausente y conserva `config.ocr.dpi`.

Ese mismo `effectiveDpi` va a `OcrPageRequest.dpi`; ese mismo `scale` calcula
`estimatedBytes` y se pasa a `rasterizePage`. El productor debe derivar la
escala desde `request.dpi`, no cerrar sobre una escala global. Así, ADR-064 y
ADR-143 siguen verdaderos. Para `ocrRegions`, o cuando el cap está ausente o es
mayor al configurado, se conserva exactamente la configuración actual.

No cambia `OcrConfig`, eventos, errores ni la salida de OCR.

### 4. Reparto y commits

1. **Contrato**: docs + `shared/src/types.ts`, campo opcional.
2. **`pdf-engine`**: calcula y puebla `ocrDpiCap`; ningún otro motor importado.
3. **façade/Orchestrator**: usa DPI/scale por descriptor.

Son tres módulos y, por R-1/ADR-124, deben quedar en commits separados si el
humano autoriza commitearlos. La implementación no edita documentación.

## Verificación obligatoria

- ráster único 1200×1600 dibujado en 600×800 pt produce cap 144;
- el mismo XObject precedido por `OPS.dependency` y un inline image con
  dimensiones válidas también producen cap — evitan una implementación que
  solo funciona contra el mock mínimo;
- una CTM rotada conserva el mismo cap;
- dimensiones inválidas/desconocidas, máscara, contenido pintado adicional o
  más de una imagen dejan el campo ausente;
- página con cap 200 y config 300 crea request `dpi: 200`, estima a 200 y
  rasteriza con `200/72`;
- cap 400, cap ausente, cap inválido y todo `ocrRegion` conservan 300;
- dos páginas con caps distintos producen escalas distintas desde cada request;
- snapshots previos no cambian cuando el campo está ausente.

## Consecuencias

- El camino común de un escaneo de una sola imagen deja de sobremuestrear sin
  pedir un corpus ni elegir un umbral.
- Los PDFs compuestos quedan deliberadamente en el comportamiento anterior.
- El cambio es aditivo en el contrato, pero abarca `shared`, `pdf-engine` y el
  façade; no puede presentarse como un commit de un solo motor.
- La curva de calidad T-6b sigue siendo posterior y no participa de esta regla.
