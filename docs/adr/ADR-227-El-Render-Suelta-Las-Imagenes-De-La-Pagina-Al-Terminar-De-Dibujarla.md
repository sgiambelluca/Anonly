<!-- CONTEXT: scope=adr | dependencias=roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md,core/Render_Engine.md,adr/ADR-225-El-Parseo-Suelta-Las-Imagenes-De-Cada-Pagina-Al-Leerla.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-043-RenderEngine-Reparto-Host-Worker-Kernel.md,adr/ADR-143-Las-Imagenes-De-OCR-Se-Producen-Cuando-Hay-Lugar.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,roadmap/memoria/H-10_Bitacora_De_Memoria.md | audiencia=humanos+planificador+implementador+revisor | fase=1.x -->

# ADR-227 — El render suelta las imágenes de la página al terminar de dibujarla

- **Estado**: **Proposed**. A/B intercalado en un contenedor Linux, con NER
  apagado (§Medición). **Reabre un descarte** (H-10 §5.2, ADR-154 §2) con una
  condición que aquella medición no cubrió: lo decide el humano.
- **Fecha**: 2026-11-05
- **Propuesto por**: el planificador, en la campaña de reducción de pico
  ([`Reduccion_De_Pico_Nube_2026-11.md`](../roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md),
  candidato C-4), a pedido del humano («mandale a las dos mediciones»).
- **Relacionado con**: ADR-225 (el mismo mecanismo en el parseo), ADR-154 §2
  (el descarte que esto reabre), ADR-043 (el kernel de Render y sus workers),
  ADR-143 (las imágenes de OCR se producen cuando hay lugar), ADR-192.

## Contexto

### 1. Cada worker de Render conserva las imágenes de las páginas que dibujó

El kernel de Render (`render-engine/src/worker/kernel.ts`) dibuja con
`pageProxy.render()` en `renderPageOntoContext`. Ese camino lo usan
`kernelRasterizePage` (la imagen que va al OCR) y `kernelRenderPage` (preview y
export). En pdfjs-dist 4.10.38:

- las imágenes decodificadas para dibujar quedan en `pageProxy.objs`, y la
  lista de operadores en `pageProxy._intentStates`;
- `PDFDocumentProxy` guarda cada página en `#pageCache` hasta `destroy()`, es
  decir, hasta que se cierra el documento;
- después de `render()`, pdf.js limpia solo si alguna imagen supera
  `MAX_IMAGE_SIZE_TO_CACHE` (10e6 bytes, `_maybeCleanupAfterRender`).

Con tres workers de Render (perfil Intermedio), cada uno se queda con lo que
dibujó de cada página hasta cerrar el documento. En un escaneo de 50 páginas,
eso se acumula durante el OCR y queda después de `Ready`.

### 2. Lo que se descartó en septiembre, y por qué esto es distinto

H-10 §5.2 probó `pageProxy.cleanup()` en el kernel de Render y el pico no se
movió (+35,9 / −5,6 / −0,7 MB). ADR-154 §2 lo cerró con dos argumentos: que
`cleanup()` solo limpia el lado principal, y que el `GlobalImageCache` de pdf.js
no cachea imágenes de una sola página.

Esta campaña midió otra cosa:

- **Sin NER.** El pico global de H-10 incluía el modelo de NER, y en esa versión
  no caía necesariamente en la fase de OCR. Acá, sin NER, el pico de P2 es el
  del OCR (§2 del informe) y lo que cambia ahí se ve.
- **Imágenes por debajo del umbral.** A 144 dpi, una página carta queda en
  1224 × 1584 px (~7,8 MB en RGBA), por debajo de los 10e6 bytes en que pdf.js
  limpia solo. El P2 de H-10 era a 216 dpi (~17 MB), por encima.
- **El primer argumento de ADR-154 no aplica a lo que se libera.** `objs` e
  `_intentStates` viven del lado principal del kernel: son justo lo que
  `cleanup()` vacía.

**No queda explicado del todo por qué H-10 no vio el efecto a 216 dpi**, que acá
sí aparece (§Medición). La explicación más probable es la primera: el pico
global de entonces no estaba en la fase de OCR. Es una inferencia.

## Medición (provisional)

Banco: contenedor Linux x86_64 de 4 CPU y 16 GB, Electron empaquetado, NER
apagado. Brazo `head` (el producto, con ADR-225 y ADR-226) contra `c4` (`head`
más `pageProxy.cleanup()` al final del `try` de `renderPageOntoContext`, solo
en el build del arnés: `tests/perf/support/peakArmsTransform.ts`). ABBA × 3,
una instancia de Electron por corrida. Crudos en
`.measure/peak-ab/c4-neroff-head-c4/`. MB del árbol de procesos, medianas, y
entre paréntesis mínimo y máximo:

| P2 sin NER, 50 páginas | `head` | `c4` | `c4` − `head` por ronda |
|---|---:|---:|---:|
| 144 dpi, pico frío | 1423 (1399–1444) | 1062 (1047–1067) | −345 / −370 / −367 |
| 144 dpi, pico caliente | 1423 (1402–1451) | 1052 (1042–1076) | −357 / −375 / −379 |
| 144 dpi, después de `Ready` (frío / caliente) | 1139 / 1149 | 751 / 744 | — |
| 216 dpi, pico frío | 1487 (1483–1502) | 1268 (1233–1296) | −200 / −233 / −238 |
| 216 dpi, pico caliente | 1474 (1464–1498) | 1298 (1243–1371) | −181 / −231 / −114 |
| 216 dpi, después de `Ready` (frío / caliente) | 1081 / 1128 | 897 / 854 | — |
| 144 dpi, `import → Ready` (frío / caliente) | 20,6 / 20,1 s | 20,4 / 20,1 s | −0,6 a +0,4 s |
| 216 dpi, `import → Ready` (frío / caliente) | 26,5 / 25,3 s | 27,0 / 26,2 s | +0,3 a +1,1 s |

- **Los rangos no se solapan** en ningún perfil ni temperatura, y las tres
  rondas van en el mismo sentido.
- **Todo el efecto está en el proceso Tab** (renderer y workers): a 144 dpi,
  1011 → 645 MB en la muestra del pico.
- **La memoria después de `Ready` baja casi tanto como el pico**, entre 180 y
  400 MB. Es la que se suma por cada pestaña abierta en la 1.2.
- **Calidad**: el texto de OCR (hash de las palabras de las 50 páginas) y la
  cantidad de grupos son idénticos en todas las importaciones.
- **Tiempo**: sin cambio a 144 dpi; a 216 dpi, entre 0,3 y 1,1 s más sobre unos
  26 s (1 a 4 %). La causa probable es que una misma página se dibuja más de una
  vez durante el OCR (por ejemplo, para la orientación y para el
  reconocimiento) y, después del cleanup, la segunda vez se vuelve a decodificar
  la imagen. No se midió por separado.
- **Una corrida de 24 no llegó a medir** (`10-r3-c4`, perfil de 144 dpi): la app
  no terminó de navegar a `app://local/index.html` en 30 s, antes de importar.
  Es una falla de arranque del arnés; ese brazo y perfil quedan con 5 corridas.

## Decisión propuesta

Llamar a `pageProxy.cleanup()` al terminar de dibujar una página en el kernel de
Render. **Hay que elegir el alcance**, porque el brazo medido limpia en todos
los renders:

1. **En todos los renders** (lo medido). El preview también suelta lo que
   dibujó, así que un re-render de la misma página por zoom o por cambio de
   vista vuelve a pedir el operator list y a decodificar la imagen. **Ese costo
   no se midió.**
2. **Solo donde cada página se dibuja una vez por etapa**: `kernelRasterizePage`
   (OCR) y `kernelRenderPage` en `mode: "full"` (export). El preview conserva lo
   que dibujó y no paga nada al hacer zoom. Captura lo que acumula el OCR; no se
   midió como brazo propio, así que antes de adoptarlo hace falta su A/B.

**Recomendación del planificador: la opción 2**, con un A/B propio antes de
aceptarla. Evita el costo no medido del preview y apunta a donde está la
acumulación.

En las dos: no cambia `Page`, ni eventos, ni contratos, ni tamaños de pool, ni
el DPI. Es un cambio interno del kernel de Render (R-1).

## Compatibilidad con varios documentos (1.2)

| Criterio | Cumple | Por qué |
|---|---|---|
| 1. No cambia pico por retención | sí, y mejora la retención | la memoria después de `Ready` baja entre 180 y 400 MB |
| 2. Nada que suponga un solo documento | sí | actúa por página de cada `PDFDocumentProxy` de cada worker |
| 3. Liberar al terminar cada etapa, no al cerrar | sí, más fino | por página, al terminar de dibujarla |
| 4. Medido frío y caliente | sí | §Medición |

## Qué falta antes de aceptarlo

- La decisión del humano entre las opciones 1 y 2. Con la 2, su A/B propio.
- Con la 1, medir el costo de re-render del preview (zoom y cambio de vista).
- El A/B con NER prendido y la confirmación en Windows nativo (ADR-192 §4),
  como para ADR-225 y ADR-226.
- El gate de export verificado (ADR-148) sobre la implementación: el export
  dibuja todas las páginas con este mismo kernel.
