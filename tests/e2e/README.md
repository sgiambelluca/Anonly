<!-- CONTEXT: scope=tests-e2e | dependencias=architecture/07_Performance_Strategy.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md | audiencia=humanos+IA | fase=10 -->

# Tests E2E (Playwright)

Suite de extremo a extremo sobre la app real en Chromium. Es el único nivel de la pirámide donde `pdfjs-dist`, `tesseract.js` y `@huggingface/transformers`/`onnxruntime-web` corren **de verdad**: todos los tests unit/contract/edge de los motores mockean esas fronteras (ADR-021 §5). Por eso esta suite destapa bugs que ningún otro gate puede ver — los siete del PR10 del Hito 10 son el precedente.

Los escenarios son los de `docs/architecture/07_Performance_Strategy.md` §11.3, uno por archivo (`scenario-N-<slug>.spec.ts`).

## Prerequisito obligatorio: `pnpm assets:mirror`

```bash
pnpm assets:mirror
```

**Sin esto la suite entera falla, no solo los escenarios de OCR/NER.** Los tres directorios de assets first-party están gitignoreados por ADR-018 y los produce el mirror:

| Directorio | Qué es | Por qué rompe todo si falta |
|---|---|---|
| `apps/react-client/src/assets/onnxruntime/` | glue `.mjs` de onnxruntime-web | Se importa con `?url` desde `core-adapter/index.ts` (ADR-039 §3). Vite **rechaza el id** al construir, así que el dev server que levanta Playwright no sirve una app funcional. |
| `apps/react-client/public/wasm/` | binarios wasm + tesseract | OCR (Escenario 2). |
| `apps/react-client/public/models/` | modelo NER (~178 MB) | Detección NER (Escenarios 1, 5, 9). |

En CI lo hace el job `test-e2e` de `.github/workflows/ci.yml`, con `actions/cache` sobre los tres directorios (clave: hash de `assets.lock.json`) para no re-descargar en cada corrida. Localmente basta correrlo una vez: los archivos persisten entre corridas.

> Nota histórica: el job `test` (suite unitaria) tenía la **misma** dependencia oculta y se resolvió por otro camino — un plugin `anonly:ort-url-asset-stub` en `vitest.config.ts` que intercepta esos dos ids. Bajar 219 MB para resolver dos imports que ninguna suite unitaria ejerce no valía la pena. El build de la app y esta suite siguen usando los archivos reales.

## Correr la suite

```bash
pnpm test:e2e
```

Levanta el dev server solo (`webServer` de `playwright.config.ts`, reusa uno ya corriendo fuera de CI) y corre los 12 specs en Chromium.

Un escenario suelto:

```bash
pnpm test:e2e tests/e2e/scenario-1-import-edit-export.spec.ts
```

Con la configuración real de CI (un worker, sin paralelismo) — obligatorio para reproducir cualquier falla que solo aparezca en CI:

```bash
pnpm test:e2e --workers=1
```

## Fixtures

Ninguno se commitea, con **una** excepción. Los genera `tests/e2e/support/fixtures.ts`:

- **En Node**, reusando `tests/fixtures/generate.ts` (`text-10p.pdf`, `corrupt.pdf`, variantes con más páginas).
- **En el browser**, para el escaneado del Escenario 2: se rasteriza `text-10p.pdf` con el `pdfjs-dist` que la app ya carga y se re-arma con pdf-lib (ADR-048 §2).

La excepción es **`tests/fixtures/protected.pdf`** (Escenario 3): pdf-lib no encripta, así que se generó una sola vez con `qpdf` y entró al repo. Su comando de reproducción está en `tests/fixtures/README.md`. ADR-018 no lo cubre: eso rige los assets first-party mirroreados, no los fixtures de test.

Ver `tests/fixtures/README.md` para el contenido conocido de `text-10p.pdf` y —importante si vas a escribir aserciones— **qué entidades detecta el pipeline de verdad**, que no es lo mismo que las que el texto contiene.

## Cómo escribir un escenario acá

Convenciones que la suite ya sostiene y conviene no romper:

- **Esperar por la condición, nunca por una duración.** `expect.poll(...)` o un `expect(...).toBeVisible({ timeout })`, jamás `page.waitForTimeout(N)` seguido de una aserción. El Escenario 11 falló las tres veces en CI justamente por un presupuesto fijo de 800 ms que alcanzaba en una máquina de desarrollo y no en un runner de 2 cores.
- **Acotar los locators a su contenedor.** `getByRole("button", { name: "Cerrar documento" })` sin scope ya no identifica el banner de error: desde ADR-051 el Toolbar tiene un botón con el mismo nombre accesible. `scenario-6-corrupt-pdf.spec.ts` tiene la forma correcta (localizar el banner y buscar adentro).
- **Afirmar el resultado, no el stage.** El Escenario 2 pasó en verde durante semanas con el OCR completamente roto porque afirmaba que el pipeline llegaba a "Listo" en vez de afirmar que había entidades.
- **`test.setTimeout(N)` es un presupuesto, no una medición.** Si un comentario cita números, que diga cuál de las dos cosas son.
