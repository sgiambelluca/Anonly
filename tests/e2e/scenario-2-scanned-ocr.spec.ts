/**
 * Escenario 2 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 2):
 * "Cargar PDF escaneado → ver progreso OCR → ver grupos → exportar."
 *
 * Fixture (ADR-048 §2, `tests/fixtures/README.md` fila "2"): generada EN EL
 * BROWSER dentro de este mismo spec (`support/scannedPdf.ts`) — rasteriza
 * `text-10p.pdf` (`generateText10p()`, mismo contenido conocido que el resto
 * de los specs) página por página con `pdfjs-dist` y re-arma un PDF de solo
 * imágenes con `pdf-lib`, sin capa de texto. El PDF Engine lo detecta como
 * páginas `requiresOCR` y el Orchestrator despacha OCR real (Tesseract.js,
 * first-party — ADR-018) antes de Regex/NER.
 *
 * El fixture generado en sí está BIEN FORMADO — verificado exhaustivamente:
 * `qpdf --check` no reporta errores, 10 páginas, tamaño de página correcto
 * (595×842 pt = A4), imagen embebida por página con las dimensiones
 * esperadas (1785×2526 px = 595×842 × scale 3), y el contenido de píxeles
 * decodificado (`zlib.inflateSync` sobre el stream `/FlateDecode` del
 * `XObject`) tiene texto no-blanco en la posición esperada de la página. El
 * problema NO es el fixture ni `support/scannedPdf.ts`.
 *
 * BUG REAL DETECTADO — no implementado (`ai/AI_Development_Guide.md` §5).
 * Con este fixture, el pipeline completo corre sin errores visibles en la UI
 * (`OCR página N de M…` aparece, el pipeline llega a `Listo`) pero detecta
 * CERO entidades — porque el motor de OCR real nunca llega a reconocer nada:
 * la consola del browser muestra, de forma reproducible:
 *
 *   Failed to execute 'importScripts' on 'WorkerGlobalScope':
 *   The URL '/wasm/tesseract/' is invalid.
 *
 * Causa raíz, confirmada en el código fuente:
 * `packages/anonymization-core/ocr-engine/src/worker/kernel.ts` (líneas 44-46):
 *
 *   const TESSERACT_LANG_PATH = "/models/tesseract/";
 *   const TESSERACT_CORE_PATH = "/wasm/tesseract/";
 *   const TESSERACT_WORKER_PATH = "/wasm/tesseract/";
 *
 * `TESSERACT_WORKER_PATH` (pasado como `workerPath` a `createWorker()` de
 * `tesseract.js`, línea ~81) queda apuntando al DIRECTORIO, no al archivo
 * real (`worker.min.js`, el nombre que `assets.lock.json`/`scripts/mirror-assets.ts`
 * efectivamente descargan en `apps/react-client/public/wasm/tesseract/worker.min.js`).
 * `tesseract.js` hace `importScripts(workerPath)` tal cual adentro de su
 * propio Worker interno — sin autocompletar el nombre de archivo — así que
 * falla con exactamente el mensaje de arriba. `TESSERACT_CORE_PATH` tiene la
 * misma forma (`"/wasm/tesseract/"`, sin archivo); `corePath` puede tolerarlo
 * mejor en algunas versiones de `tesseract.js` (autodetección de variante
 * SIMD/no-SIMD sobre un directorio), pero comparte el mismo patrón sospechoso
 * y merece revisión en el mismo PR de fix.
 *
 * `OcrEngine.processPage` (host-side, `ocr.engine.ts`) atrapa el fallo del
 * kernel sin propagarlo como error fatal del pipeline (deja `words: []`,
 * `confidence: 0` — el mismo camino que el caso límite "página sin texto" de
 * `docs/core/OCR_Engine.md` §13 casos 1-2), así que el pipeline sigue de
 * largo hasta `Ready` sin ningún banner de error — el único síntoma visible
 * es "cero grupos detectados", indistinguible en la UI de "el documento
 * realmente no tenía texto".
 *
 * Es un bug real de `packages/anonymization-core/ocr-engine` (una constante
 * mal armada, `TESSERACT_WORKER_PATH`/posiblemente `TESSERACT_CORE_PATH` sin
 * el nombre de archivo), fuera de alcance de este PR (`tests/e2e/`/
 * `tests/fixtures/`/`.github/`/`package.json` raíz — motor cerrado, PR14).
 * Nunca se había ejercitado antes: es la primera vez que OCR real (Tesseract
 * real, worker real) corre sobre un PDF sin capa de texto de punta a punta —
 * los tests unit/contract de `ocr-engine` mockean la frontera de
 * `tesseract.js` (ADR-021 §5) y nunca invocan `createWorker()` de verdad.
 *
 * Pregunta concreta para el planificador: ¿corresponde un PR de Core que
 * corrija `TESSERACT_WORKER_PATH`/`TESSERACT_CORE_PATH` en
 * `ocr-engine/src/worker/kernel.ts` para apuntar a los archivos reales (p.
 * ej. `"/wasm/tesseract/worker.min.js"`)? Hasta entonces, el reconocimiento
 * de OCR real no es ejercitable end-to-end y este test queda como `fixme`.
 */

import { test } from "@playwright/test";

test.fixme(
  "Escenario 2: cargar PDF escaneado → ver progreso OCR → ver grupos → exportar " +
    "(bloqueado: bug real en ocr-engine — TESSERACT_WORKER_PATH apunta a un directorio, " +
    "no al archivo del worker; ver comentario de este archivo)",
  async () => {
    // Nunca se ejecuta: `test.fixme(title, body)` registra el test pero
    // Playwright lo saltea sin correr el body.
  },
);
