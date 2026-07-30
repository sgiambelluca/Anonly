/**
 * Escenario 7 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 7):
 * "Abrir y cerrar 10 documentos consecutivos → verificar que la memoria
 * regresa al baseline." Reparto (ADR-048 §3): PR17 ejercita el **flujo**
 * (cada `DOCUMENT_CLOSED` deja el estado limpio — sin documento activo, sin
 * preview, sin blob URLs vivos — y el ciclo 10 se comporta igual que el 1);
 * la medición de bytes contra baseline queda para `tests/leak/` (Hito 11).
 *
 * AMBIGÜEDAD DETECTADA — no implementado (`ai/AI_Development_Guide.md` §5).
 * No hay, hoy, ninguna forma de "cerrar" desde la UI un documento que se
 * importó con éxito (fuera de los flujos de error/contraseña), así que no se
 * puede ejercitar un ciclo real de "abrir y cerrar 10 documentos" — el
 * Orchestrator además EXIGE ese cierre explícito antes de poder importar el
 * siguiente:
 *
 * - `packages/anonymization-core/src/orchestrator.ts` (`validateImportInput`,
 *   ~línea 1547): `importDocument` lanza `InvalidInputError` — "Ya hay un
 *   documento activo (…); cerralo antes de importar otro (MVP, caso 12)" — si
 *   ya hay un `activeDocumentId`. Un ciclo de 10 aperturas reales necesita
 *   cerrar cada uno antes del siguiente `setInputFiles`.
 * - `apps/react-client/src/components/toolbar/Toolbar.tsx`: solo renderiza
 *   `ImportButton` cuando `stage === PipelineStage.Idle`; en cualquier otro
 *   stage muestra `PipelineStatus` + `CancelButton` + `ExportButton` +
 *   `SettingsButton` — ninguno de ellos es un control genérico de "cerrar
 *   documento".
 * - `apps/react-client/src/components/toolbar/PipelineStatus.tsx` (comentario
 *   de cabecera, líneas 24-27): "el mensaje de error + 'Cerrar documento'
 *   (`actions.closeDocument`) siempre" — `actions.closeDocument()` solo está
 *   cableado al banner de `stage === Failed`.
 * - `apps/react-client/src/components/toolbar/PasswordDialog.tsx`
 *   (líneas 139-155): el único OTRO camino de UI a `actions.closeDocument()`
 *   — el botón "Cancelar" del diálogo de contraseña, que ofrece cerrar el
 *   documento protegido. Gateado detrás de `PDF_PASSWORD_REQUIRED`.
 * - `apps/react-client/src/components/toolbar/CancelButton.tsx`: "Cancelar"
 *   llama `actions.cancel()` (`CANCEL_REQUESTED`), que lleva el stage a
 *   `Cancelled` — **no** llama `actions.closeDocument()`. Tras cancelar,
 *   `Toolbar` sigue sin mostrar `ImportButton` (`isIdle` exige
 *   `stage === Idle`, no `Cancelled`), así que tampoco desde ahí hay forma de
 *   iniciar el siguiente ciclo.
 * - `docs/ui/Components.md`: las únicas dos menciones a "cerrar" son la fila
 *   de `stage === Failed` (línea ~75: "banner de error + 'Reintentar' o
 *   'Cerrar'") y la de `PasswordDialog` (línea ~118: "Cancelar: cierra el
 *   diálogo y ofrece cerrar el documento"). Ningún control documentado cierra
 *   un documento que se está procesando o que ya terminó con éxito.
 *
 * En resumen: un ciclo real de "abrir y cerrar 10 documentos exitosos" no es
 * ejercitable end-to-end con la UI documentada hoy — sería necesario agregar
 * un control genérico de "Cerrar documento" al `Toolbar` (cambio de
 * `apps/react-client/src/components`, fuera del alcance de este PR, que es
 * solo `tests/e2e/`/`tests/fixtures/`/`.github/workflows/ci.yml`/`package.json`
 * raíz), o reinterpretar el escenario para reusar uno de los dos flujos de
 * cierre existentes (p. ej. importar `corrupt.pdf` 10 veces y cerrar vía el
 * banner de `Failed`, similar a `scenario-6-corrupt-pdf.spec.ts`) — pero eso
 * no cubriría el ciclo de "documento exitoso" que sugiere `07` §11.3 item 7,
 * ni generaría preview/blob URLs reales que limpiar (`corrupt.pdf` falla en
 * `Extracting`, antes de que Render llegue a correr).
 *
 * Pregunta concreta para el planificador: ¿cuál es el mecanismo de UI que
 * debería usar el Escenario 7 para "cerrar" un documento que abrió con éxito
 * (fuera de los flujos de error/contraseña)? ¿Falta un control genérico de
 * "Cerrar documento" en el `Toolbar` — y si es así, es un PR pendiente del
 * Hito 10, o queda diferido — o el escenario debe reinterpretarse para reusar
 * uno de los flujos de cierre ya existentes? Hasta que exista ese control (o
 * una respuesta que reinterprete el escenario), este test queda como `fixme`.
 */

import { test } from "@playwright/test";

test.fixme(
  "Escenario 7: abrir y cerrar 10 documentos consecutivos → estado limpio por ciclo " +
    "(bloqueado: no hay forma de cerrar un documento exitoso desde la UI, ver comentario de este archivo)",
  async () => {
    // Nunca se ejecuta: `test.fixme(title, body)` registra el test pero
    // Playwright lo saltea sin correr el body.
  },
);
