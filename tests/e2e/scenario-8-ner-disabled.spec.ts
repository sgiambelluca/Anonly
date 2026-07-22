/**
 * Escenario 8 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 8):
 * "Cargar PDF sin NER activado → verificar que solo Regex detecta."
 *
 * AMBIGÜEDAD DETECTADA — no implementado (`ai/AI_Development_Guide.md` §5).
 * No hay, hoy, ninguna forma de desactivar NER **antes** de importar el
 * primer documento a través de la UI documentada:
 *
 * - `apps/react-client/src/App.tsx` llama `initCore()` **sin argumentos**,
 *   una única vez, dentro de un `useEffect(() => { ... }, [])` en el mount de
 *   `App` — antes de que el usuario pueda tocar nada de `SettingsDialog`.
 * - `apps/react-client/src/core-adapter/index.ts` (comentario de
 *   `initCore`): "este PR no deriva un `EngineConfig` desde `settings.store`
 *   (ver nota de ambigüedad en el reporte del PR: `Partial<EngineConfig>`
 *   exige sub-objetos completos por campo, y el cliente no tiene visibilidad
 *   de varios defaults internos del Core que no están en `core/Contracts.md`
 *   §6)".
 * - `apps/react-client/src/components/toolbar/SettingsDialog.tsx`
 *   (comentario de cabecera): con el `SettingsDialog` abierto y **sin**
 *   documento activo, cambiar `nerEnabled` "se persisten sin diálogo ni
 *   `reanalyze` (solo afectan al próximo `createCore`, que hoy ocurre una
 *   sola vez por carga de la app — `core-adapter/index.ts` no deriva
 *   `EngineConfig` de `settings.store` todavía, gap heredado de PR5, fuera de
 *   alcance de este PR)".
 * - `docs/ui/React_Client.md` §3.7 confirma la intención ("Sin documento
 *   abierto, estos dos settings solo afectan al próximo `createCore`"), pero
 *   ningún PR implementó todavía ese "próximo `createCore`" derivado de
 *   `settings.store` — `initCore()` no vuelve a llamarse nunca en la vida de
 *   la pestaña.
 *
 * En resumen: activar/desactivar NER en `SettingsDialog` antes de importar un
 * documento persiste en `localStorage` pero **no tiene ningún efecto
 * observable** sobre el `EngineConfig` real que ya recibió `createCore()`, y
 * no existe otro mecanismo (env var, query param, flag de test expuesto en
 * `window`) documentado en `docs/` para lograrlo. Añadir ese wiring sería un
 * cambio de lógica de `apps/react-client/src/core-adapter/index.ts` (fuera
 * del alcance de este PR, que es solo `tests/e2e/`), no una instrumentación
 * de testing.
 *
 * Pregunta concreta para el planificador: ¿el wiring `settings.store` →
 * `EngineConfig` (para que un `nerEnabled: false` persistido antes de la
 * primera importación realmente desactive NER) es un PR pendiente del Hito
 * 10 — y si es así, cuál — o queda diferido a v1.0? Hasta que exista ese PR
 * (o un mecanismo alternativo documentado), este escenario no es ejercitable
 * end-to-end y este test queda como `fixme`.
 */

import { test } from "@playwright/test";

test.fixme(
  "Escenario 8: cargar PDF sin NER activado → verificar que solo Regex detecta " +
    "(bloqueado: no hay forma de desactivar NER antes de importar, ver comentario de este archivo)",
  async () => {
    // Nunca se ejecuta: `test.fixme(title, body)` registra el test pero
    // Playwright lo saltea sin correr el body.
  },
);
