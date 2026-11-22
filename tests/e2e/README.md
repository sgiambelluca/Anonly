<!-- CONTEXT: scope=tests-e2e | dependencias=architecture/07_Performance_Strategy.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-048-Cierre-E2E-Hito10-Fixtures-Assets-Escenarios.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md | audiencia=humanos+IA | fase=12 -->

# Tests E2E (Playwright)

Suite de extremo a extremo sobre la app Electron empaquetada. Es el único nivel de la pirámide donde `pdfjs-dist`, `tesseract.js` y `@huggingface/transformers`/`onnxruntime-web` corren **de verdad**: todos los tests unit/contract/edge de los motores mockean esas fronteras (ADR-021 §5). Por eso esta suite destapa bugs que ningún otro gate puede ver — los siete del PR10 del Hito 10 son el precedente.

Los escenarios son los de `docs/architecture/07_Performance_Strategy.md` §11.3, uno por archivo (`scenario-N-<slug>.spec.ts`, del 1 al 12). El resto de los specs de la carpeta son regresiones puntuales, cada una con su caso en el comentario de cabecera. Las familias principales (la tabla no es exhaustiva):

| Familia | Specs |
|---|---|
| Recuperación de texto y OSD (ADR-190) | `adr190-*.spec.ts` |
| Archivo exportado (ADR-148) | `export-verification.spec.ts`, `scanned-rotated-export.spec.ts`, `line-repaint-pixels.spec.ts`, `export-version-lifecycle.spec.ts` |
| Menús y globos dentro del área visible (ADR-207) | `group-context-menu-placement.spec.ts`, `mode-menu-opens-upward.spec.ts`, `selection-popover-placement.spec.ts`, `search-popover-placement.spec.ts` |
| Visor | `viewer-*.spec.ts`, `anonymized-interaction-geometry.spec.ts`, `search-box-narrow-window.spec.ts` |
| La 1.1 de punta a punta: tipo y formato propios, detección, export y OCR independiente | `v1-1-user-format-end-to-end.spec.ts` |
| Shell y seguridad | `protocol-headers.spec.ts`, `security-gates.spec.ts`, `update-check-feedback.spec.ts` |

Fuera de la tabla quedan specs sueltos, como `dark-mode-contrast`, `toast-interaction` o `settings-before-scan`; `t5-orientation-pixel` solo corre con `ANONLY_T5_E2E=1`. El listado de la carpeta es la fuente de verdad. Esta tabla orienta y puede quedar atrás.

## Prerequisito obligatorio: `pnpm assets:mirror`

```bash
pnpm assets:mirror
```

**Sin esto la suite entera falla, no solo los escenarios de OCR/NER.** Los tres directorios de assets first-party están gitignoreados por ADR-018 y los produce el mirror:

| Directorio | Qué es | Por qué rompe todo si falta |
|---|---|---|
| `apps/react-client/src/assets/onnxruntime/` | glue `.mjs` de onnxruntime-web | Se importa con `?url` desde `core-adapter/index.ts` (ADR-039 §3). Vite **rechaza el id** al construir, así que el build del renderer que corre `test:e2e` falla. |
| `apps/react-client/public/wasm/` | binarios wasm + tesseract | OCR (Escenario 2). |
| `apps/react-client/public/models/` | modelo NER (~178 MB) | Detección NER (Escenarios 1, 5, 9). |

En CI lo hace el job `test-e2e` de `.github/workflows/ci.yml`, con `actions/cache` sobre los tres directorios (clave: hash de `assets.lock.json`) para no re-descargar en cada corrida. Localmente basta correrlo una vez: los archivos persisten entre corridas.

> Nota histórica: el job `test` (suite unitaria) tenía la **misma** dependencia oculta y se resolvió por otro camino — un plugin `anonly:ort-url-asset-stub` en `vitest.config.ts` que intercepta esos dos ids. Bajar 219 MB para resolver dos imports que ninguna suite unitaria ejerce no valía la pena. El build de la app y esta suite siguen usando los archivos reales.

## Correr la suite

```bash
pnpm test:e2e
```

Construye el renderer (con `VITE_E2E=1`) y el shell, y corre todos los specs de la carpeta sobre la app Electron (`playwright.electron.config.ts`, un worker).

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

### Gate del archivo exportado (ADR-148)

Spec cerrado el 2026-10-05 en
[`Export_Verificado_ADR148_Plan.md`](../../docs/roadmap/hardening/Export_Verificado_ADR148_Plan.md).
Primera implementación entregada y **sin aprobar**: 20/21 tests pasan en
Windows, cero salteados. Hallazgos y correcciones en
[`ADR148_Revision_2026-10-05.md`](../../docs/roadmap/hardening/ADR148_Revision_2026-10-05.md).
La segunda revisión de Sol 6.1 fue REJECTED: el fixture mixed
contradecía el mínimo de ADR-065 y necesitaba resolver su política;
[`informe y decisión humana`](../../docs/roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md).
Ese hallazgo quedó resuelto por ADR-203: cierre histórico APPROVED,
21/21 Windows/macOS y CI verde, con la política vigente de 100 pt
([cierre](../../docs/roadmap/hardening/ADR148_Cierre_ADR203_2026-10-05.md)).
La ampliación del 2026-10-10 conserva esas 21 filas y agrega renglón
repintado con etiqueta larga y tinta tenue: **23/23 localmente, cero fallos,
salteados o flaky**, revisión del lote pendiente
([evidencia](../../docs/roadmap/hardening/Export_Gate_Ampliacion_2026-10-10.md)).
Requiere Electron, motores reales, OCR verificador independiente sobre los
bytes finales y controles del original. El test de píxeles
`scanned-rotated-export.spec.ts` aporta un antecedente, pero no cubre ese
gate. El comando existente y el estado de CI se registran únicamente en
`docs/architecture/07_Performance_Strategy.md` §11.4.

### Convenciones de escenarios

Convenciones que la suite ya sostiene y conviene no romper:

- **Esperar por la condición, nunca por una duración.** `expect.poll(...)` o un `expect(...).toBeVisible({ timeout })`, jamás `page.waitForTimeout(N)` seguido de una aserción. El Escenario 11 falló las tres veces en CI justamente por un presupuesto fijo de 800 ms que alcanzaba en una máquina de desarrollo y no en un runner de 2 cores.
- **Acotar los locators a su contenedor.** `getByRole("button", { name: "Cerrar documento" })` sin scope ya no identifica el banner de error: desde ADR-051 el Toolbar tiene un botón con el mismo nombre accesible. `scenario-6-corrupt-pdf.spec.ts` tiene la forma correcta (localizar el banner y buscar adentro).
- **Afirmar el resultado, no el stage.** El Escenario 2 pasó en verde durante semanas con el OCR completamente roto porque afirmaba que el pipeline llegaba a "Listo" en vez de afirmar que había entidades.
- **`test.setTimeout(N)` es un presupuesto, no una medición.** Si un comentario cita números, que diga cuál de las dos cosas son.

## Los roles ARIA de la UI son API de esta suite

Estos escenarios localizan por rol accesible (`getByRole`), no por clase ni por
`data-testid`. Es deliberado —un test que se rompe cuando la accesibilidad se
rompe es una red gratis— pero tiene una consecuencia que hay que tener presente:

**`pnpm test` no corre esta suite.** El subset pre-PR de `CLAUDE.md` (`pnpm gates`:
`lint`, `typecheck`, `test`, `test:contract`, `format:check`) puede quedar entero en verde con la UI
rota para el usuario de lector de pantalla y para estos tests a la vez.

Ya pasó: retirar `role="menuitem"` de `GroupContextMenu` —un cambio correcto,
porque el rol prometía navegación por flechas que no existe— dejó los cuatro
gates verdes y rompió tres escenarios en CI, cada uno con 150 s de timeout y dos
reintentos.

Así que: **si tocás un `role`, un `aria-label` o el texto visible de un control,
corré `pnpm test:e2e` en el mismo cambio.** Los locators afectados están
concentrados y son fáciles de encontrar:

```bash
grep -rn "getByRole" tests/e2e/
```
