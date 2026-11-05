<!-- CONTEXT: scope=adr | dependencias=roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md,core/PDF_Engine.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-066-Texto-De-Anotaciones-Y-Reemplazo-Rotado.md,adr/ADR-163-El-DPI-De-OCR-No-Supera-Al-Raster-Fuente.md,adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md,roadmap/memoria/H-10_Bitacora_De_Memoria.md | audiencia=humanos+planificador+implementador+revisor | fase=1.x -->

# ADR-225 — El parseo suelta las imágenes de cada página al terminar de leerla

- **Estado**: **Accepted** por el humano el 2026-11-05 («Acepto los dos cambios»).
  Se implementa en `perf/pico-memoria`. La repetición del A/B con NER y la
  confirmación en Windows nativo («Qué falta antes de aceptarlo») pasan a ser
  verificaciones de la implementación: si refutan la ganancia, se revierte.
- **Fecha**: 2026-11-05
- **Propuesto por**: el planificador, en la campaña de reducción de pico
  ([`Reduccion_De_Pico_Nube_2026-11.md`](../roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md),
  candidato C-1).
- **Relacionado con**: ADR-154 §2 (levers de memoria y el descarte de
  `cleanup()` en el kernel de Render), ADR-066 §1 (por qué `parsePage` pide el
  operator list), ADR-163 (`ocrDpiCap`, que se deriva de ese recorrido),
  ADR-218 (el método de build aislado), ADR-192 (techos por perfil).

## Contexto

### 1. El pico de un escaneo cae en el parseo, no en el OCR

En la campaña de 2026-11, P2 (50 páginas escaneadas) con NER apagado tuvo su
pico global **al final de la fase `DOCUMENT_IMPORTED → DOCUMENT_PARSED`**, en
el proceso del renderer (Tab), en frío y en caliente. El RSS sube unos 950 MB
durante los ~3 s del parseo (mediana de 6 corridas: de 684 a 1629 MB) y cae al
emitirse `DOCUMENT_PARSED`. El OCR, que
dura más de 20 s, pica menos.

### 2. Por qué: pdf.js conserva lo que decodificó para el operator list

`parsePage` (`pdf-engine/src/pdf.engine.ts`) pide `getOperatorList()` de cada
página. Lo necesita para las compuertas de OCR por región (ADR-065), para el
texto de anotaciones (ADR-066) y para `ocrDpiCap` (ADR-163). En una página
escaneada, armar el operator list obliga a pdf.js a **decodificar la imagen**
y mandarla al lado principal. En pdfjs-dist 4.10.38:

- la imagen se guarda en `pageProxy.objs` (`pdf.mjs`, manejador de `"obj"`,
  caso `"Image"`);
- `PDFDocumentProxy` guarda cada `PDFPageProxy` en `#pageCache`, que solo se
  vacía en `destroy()`;
- después de `render()`, pdf.js programa con 5 s de retardo la limpieza de las
  páginas con imágenes de más de 10e6 bytes (`_maybeCleanupAfterRender`,
  ADR-227 §1). **Después de `getOperatorList()` no programa nada.**

Resultado: durante el parseo se acumulan los píxeles decodificados de **todas**
las páginas escaneadas del documento, hasta que el motor destruye el documento
al terminar. `parsePage` nunca llama a `pageProxy.cleanup()`, y no usa
`pageProxy.objs` para nada: el recorrido del operator list lee solo
operadores y argumentos.

### 3. Lo que ya se descartó, y por qué esto es otro sitio

ADR-154 §2 y la bitácora H-10 §5.2 descartaron `pageProxy.cleanup()` **en el
kernel de Render, durante el OCR**: el pico no se movió. Por qué no se vio entonces queda **sin explicar del todo**: después de
`render()` pdf.js solo programa, con 5 s de retardo, la limpieza de las páginas
con imágenes de más de 10e6 bytes, y C-4 (ADR-227) midió después que sin NER el
`cleanup()` en el kernel de Render sí baja el pico. La explicación más probable
es que el pico global de H-10, con NER, no caía en la fase de OCR. Es una
inferencia.
Este ADR no repite aquel cambio. Propone el cleanup en
**otra función, de otro motor (PDF Engine), en otra fase (el parseo) y después
de otra llamada (`getOperatorList()`)**, donde esa limpieza automática no
existe. El A/B de abajo es lo que lo distingue en números.

`core/PDF_Engine.md` §13 caso 2 dice que «la memoria pico [la gestiona el] LRU
del `PDFDocumentProxy` (pdfjs descarta páginas procesadas)». Medido y leído en
el código de pdf.js, **eso no pasa**: no hay LRU de páginas. Si este ADR se
acepta, ese caso límite se corrige en el mismo commit que el ADR.

## A/B medido (provisional)

Banco: contenedor Linux x86_64 de 4 CPU y 16 GB, Electron empaquetado, NER
apagado. ABBA × 3, una instancia de Electron por corrida, 12 corridas por
perfil, cada una con su importación fría y su caliente. Brazo A: producto
tal cual. Brazo B: el cambio de §Decisión, aplicado solo en el build del
arnés (`parseCleanupTransform.ts`, una coincidencia exacta; versión del arnés
de `36e92e3`, reemplazada por `run-peak-ab.sh` al implementar).
Detalle y crudos en el informe de la campaña, §4.

**P2 sin NER (50 páginas escaneadas)**, MB del árbol de procesos, medianas de 6
corridas por brazo y, entre paréntesis, mínimo y máximo:

| | A | B | B − A por ronda |
|---|---:|---:|---:|
| Pico total, frío | 1629 (1599–1691) | 1532 (1503–1543) | −90 / −122 / −97 |
| Pico total, caliente | 1716 (1664–1726) | 1553 (1531–1570) | −147 / −161 / −163 |
| Pico del parseo, frío | 1629 | 1014 | — |
| Pico del parseo, caliente | 1716 | 1090 | — |
| Proceso Tab en el pico, frío | 1176 | 1072 | — |
| Memoria después de `Ready`, frío / caliente | 1169 / 1211 | 1156 / 1157 | — |
| `import → Ready`, frío | 27,7 s | 27,3 s | −0,7 / −0,2 / −0,6 s |
| `import → Ready`, caliente | 26,2 s | 26,4 s | −0,1 / +0,6 / −0,3 s |

- **Los rangos de A y B no se solapan**, ni en frío ni en caliente, y las tres
  rondas van en el mismo sentido.
- **El pico del parseo baja unos 620 MB.** El pico total baja menos (≈ 100 MB
  en frío, ≈ 160 MB en caliente) porque, sin el parseo, el pico pasa a ser el
  del OCR, que el cambio no toca.
- **El tiempo no cambia** más allá del ruido entre corridas.
- **El texto del OCR (hash de todas las palabras por página) y la cantidad de
  grupos son idénticos** en las 24 importaciones.

**P1 sin NER (10 páginas de texto nativo)**: sin efecto, como se esperaba. Pico
frío 647 → 643 MB y caliente 715 → 713 MB (−1 a −5 MB por ronda), los mismos 6
grupos en todas las corridas y el mismo tiempo. En un PDF sin imágenes el
operator list no decodifica nada.

## Decisión propuesta

1. `parsePage` llama a `pageProxy.cleanup()` en cuanto termina de recibir el
   operator list, antes de recorrerlo. El recorrido no usa `objs`, y
   `pageProxy.rotate` y el viewport siguen disponibles después del cleanup.
2. No cambia `Page`, ni eventos, ni contratos, ni tamaños de pool, ni el DPI
   del OCR. Es un cambio interno de un solo motor (R-1).
3. El caso límite 2 de §13 de `core/PDF_Engine.md` se corrige con lo leído en
   el código de pdf.js (Contexto §2) y lo medido en «A/B medido».

## Compatibilidad con varios documentos (1.2)

| Criterio | Cumple | Por qué |
|---|---|---|
| No cambia pico por retención | sí | baja el pico y no retiene nada nuevo; tampoco cambia la memoria después de `Ready` |
| No supone un solo documento | sí | actúa sobre cada página de cada `PDFDocumentProxy`; no hay estado global |
| Libera al terminar una etapa, no al cerrar | sí, y más fino | libera por página, dentro de la etapa de parseo |
| Se mide en frío y en caliente | sí | el A/B midió los dos |

## Calidad y tiempo

- **Calidad**: en las 24 importaciones de P2, el texto de OCR (hash de las
  palabras por página) y la cantidad de grupos fueron idénticos entre brazos;
  en P1, la cantidad de grupos también. El A/B no compara palabra por palabra
  la salida del parseo nativo: la implementación tiene que correr los tests de
  contrato, unidad, edge y snapshot del PDF Engine, que fijan la salida de
  `parsePage` sobre PDFs reales y sintéticos.
- **Tiempo**: ver la tabla. `cleanup()` es una operación local del lado
  principal (vacía dos mapas); no agrega mensajes al worker de pdf.js.

## Qué falta antes de aceptarlo

- El mismo A/B con NER prendido, sobre P1, P2 y P2-dense de `memory.spec.ts`.
  En P1 (texto nativo) se espera que no cambie nada.
- La confirmación del techo en Windows nativo (ADR-192 §4). El tamaño del
  efecto depende de cómo el SO cuenta la memoria de imágenes decodificadas.
- La decisión del humano.

## Consecuencias

- Con el pico del parseo fuera del camino, el pico de un escaneo pasa a ser el
  del OCR. El margen ganado depende de cuánto le lleva el parseo al OCR en
  cada equipo.
- Un PDF escaneado más largo que P2, como el P2-200 opt-in, debería notarlo
  más, porque hoy el parseo acumula las imágenes de todas sus páginas. **No se
  midió.**
- Con NER prendido, en caliente el modelo puede seguir residente durante el
  parseo del documento siguiente (ADR-226). Si es así, el pico del parseo se
  suma al modelo y este cambio pesaría más en el caso caliente que en el frío.
  Es una predicción: la mide el A/B con NER de «Qué falta antes de aceptarlo».
