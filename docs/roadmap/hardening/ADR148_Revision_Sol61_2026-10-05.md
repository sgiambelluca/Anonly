<!-- CONTEXT: scope=revision-adr148 | dependencias=roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,core/PDF_Engine.md,adr/ADR-065-OCR-Por-Region.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=12 -->

# ADR-148 — revisión independiente de Sol 6.1

> Registro histórico de las primeras rondas. La ronda posterior bajo ADR-203
> cerró el corpus elegible con 21/21 y R-16 verdes: Sol 6.1 **APPROVED local**.
> La limitación del mixed pequeño permanece; CI completa success posterior, run 37383499951. Ver
> [el cierre posterior](ADR148_Cierre_ADR203_2026-10-05.md).

**2026-10-05. VEREDICTO: REJECTED.** Revisión del working tree actual,
incluidos los archivos nuevos, después de las correcciones de Luna a la
primera entrega. El revisor no modificó archivos ni hizo commits.

## Corpus mixto incompatible con la política vigente (P1)

`exportVerificationFixtures.ts` coloca una imagen de **300 × 56 pt**.
El E2E exige detectar el DNI de esa imagen, pero `PDF_Engine.md` y ADR-065
exigen **ambos lados ≥100 pt**. `pdf.engine.ts` aplica ese filtro y clampa
la región a la imagen: su altura no puede superar 56 pt.

El revisor reprodujo el rojo: 1 test ejecutado, 1 fallido, 0 salteados,
34,8 s. El OCR independiente lee ambos DNI y todos los vecinos. El producto
llega a Ready con un grupo y 66 palabras nativas, `requiresOCR=false`,
`ocrRegions=[]`, `ocrWords=[]` y ningún `OCR_PAGE_FINISHED`. El Orchestrator
omite OCR conforme a esa entrada.

**Es un error del plan/corpus que cerró el planificador, no una prueba de
defecto de wiring.** El implementador no debe cambiar umbrales ni facilitar
el fixture para obtener verde.

**Decisión del humano, 2026-10-05:** investigar también imágenes pequeñas,
planificando un cambio de política en una tarea independiente con medición
de calidad y memoria. Plan:
[Regiones_Pequenas_Investigacion_Plan.md](../ocr/Regiones_Pequenas_Investigacion_Plan.md).
Esto autoriza la investigación; **no decide todavía un umbral ni habilita
un cambio del runtime**. La fila mixed de ADR-148 sigue bloqueada.

## Formato obligatorio rojo (P2)

`prettier --check` sale con código 1 para:

- `tests/e2e/export-verification.spec.ts`.
- `tests/e2e/support/exportVerificationFixtures.ts`.
- `tests/e2e/support/exportVerificationOcr.ts`.
- `tests/e2e/support/exportVerificationRuntime.ts`.
- `tests/e2e/support/scannedPdf.ts`.

Corrección mecánica a cargo del implementador. R-16 exige formato verde.

## Suscripciones sin cleanup garantizado (P2)

`export-verification.spec.ts` descarta tres handles de desuscripción al
instalar los observadores de diagnóstico. También ocurre en las pruebas
de rotación. El listener `will-download` solo se retira en la ruta exitosa;
una aserción anterior evita esa limpieza.

Electron termina por test, lo que acota la retención, pero §3 del plan exige
limpieza explícita en `finally` incluso al fallar. Conservar y retirar
handles desde el spec; no tocar el producto.

## Verificaciones propias del revisor

- Unit tests del comparador: 12/12.
- ESLint scoped: verde.
- TypeScript de `tests` y `tests/e2e`: sin diagnósticos.
- Formato scoped y mixed E2E: rojos reproducidos.
- Las correcciones históricas de causa del sello, números pegados, evidencia,
  ambos DNI rotados, controles raster-only, hashes Node y ESLint están presentes.
- No repitió gate completo ni subset monorepo R-16 ante bloqueos concretos.
  No midió cobertura/memoria ni verificó CI/macOS.

El informe se devuelve al mismo implementador Luna. Puede resolver formato
y cleanup mientras se investiga la política; no cambiar fixture, oráculo,
umbral ni producto. Una próxima aprobación exige criterio mixto resuelto
y las pasadas completas de verificación.

## Segunda ronda del mismo revisor, 2026-10-05

**VEREDICTO: REJECTED.** El formato y las suscripciones de diagnóstico,
OCR, fallo de rotación y `will-download` quedaron corregidos. Los handles
se conservan y se retiran desde `finally`.

Nuevo hallazgo **P2**: el spec agrega `page.waitForTimeout(500)` antes de
comprobar que no hubo descarga en el rechazo de una página nativa rotada.
`tests/e2e/README.md` prohíbe esperas fijas seguidas de aserciones; ese plazo
no demuestra que no pueda ocurrir una descarga posterior. Retirar la
espera y comprobar el contador al observar el rechazo terminal
(`PIPELINE_FAILED`, mensaje visible y exportación oculta), conservando el
cleanup. Se devuelve al mismo implementador Luna.

El revisor confirmó formato, ESLint scoped, ambos proyectos TypeScript,
12/12 unit tests y `git diff --check` verdes. No repitió E2E, gate completo,
R-16 ni mediciones ante el bloqueo conocido de mixed. El P1 sigue abierto:
la decisión de investigar regiones pequeñas no define aún una política
de producto que permita aprobar los 21 casos.

## Cierre de correcciones mecánicas, 2026-10-05

Luna retiró la espera fija y el mismo revisor confirmó el cierre del P2,
sin nuevas regresiones. La aserción sigue al rechazo terminal y se
conservan las lecturas del contador y la limpieza en `finally`.

Verificación independiente: Prettier y ESLint del spec, TypeScript E2E,
12/12 unit tests, `git diff --check` y native Rotate90 dirigido (1/1,
cero salteados), todos verdes. No repitió mixed, gate completo ni R-16.

**VEREDICTO GLOBAL FINAL DE ESTA RONDA: REJECTED únicamente por P1.**
Formato, cleanup y espera fija están cerrados. No queda otra corrección
mecánica asignada a Luna; corresponde continuar con la investigación de
regiones pequeñas antes de resolver la política y validar los 21 casos.
El planificador recibió los avisos y encadenó implementador y revisor
durante el mismo turno, sin requerir avisos del humano.
