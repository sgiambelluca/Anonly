<!-- CONTEXT: scope=perfilado-tiempo-fuera-ocr | plan=Perfilado_Tiempo_Fuera_OCR_Plan.md | estado=M-0..M-3 cerrados -->

# Perfilado de tiempo fuera de OCR — M-0..M-3

Fecha de corrida: 2026-09-17. El arnés corre sobre Electron empaquetado, un
worker de Playwright y `retries: 0`. Cada fila es una instancia independiente
de Electron con importación fría, cierre y posterior importación caliente.

## M-0 — línea base reproducible

| Dato | Valor |
| --- | --- |
| Commit | `0017f8cd9ffae70b34f650f0f200bba6086bc3cd` |
| Pools | PDF 4, OCR 2, NER 2, Render 4 |
| NER / idiomas / DPI | activo / `spa`+`eng` / 300 |
| `maxLiveImageBytes` | 128 MiB |
| Build React | `40585b0935b09cc9214120635b454cc953a7496ce52d3effd6848afd13df0013` (`dist/index.html`) |
| Build shell | `67078be35f038ebbd1368368e119b6ccea63aa02c36c6e7dc8a1500fb6dc1bfc` (`dist/main.js`) |
| `assets.lock.json` | `70d31a6f9ff135d989833a1059f5a7b17d20acaec8472ad97eab47410ddc4b6b` |
| P2 | `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`, SHA-256 `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f` |
| P1 congelado | `.measure/fixtures/text-10p-frozen.pdf`, SHA-256 `b96b0c00b645bca1cd991deb248f499da132155723e96c8144f35bfd4c5a9824` |

Las salidas crudas están en
`.measure/tiempo-fuera-ocr/20260917-reproducible/{p1,p2}-run{0,1,2}.json`.
Las carpetas `prepatch*`, `invalid-quality` contienen corridas descartadas
durante la puesta a punto del instrumento y no entran en las cifras.
P1 corresponde al build sin el probe interno; P2 se repitió sobre el build
temporal de M-2. Por eso las magnitudes absolutas entre P1 y P2 no son una
comparación controlada del costo del probe. La identidad del build
instrumentado y el SHA-256 del patch están en `manifest.json`.

## M-1 — seis sesiones

Todas las duraciones están en milisegundos; se publica mediana y rango de las
tres corridas. P1 no emite OCR.

| Perfil/temperatura | Importado→Ready | Importado→Parsed | Parsed→OCR | OCR | OCR→Ready | NER_STARTED→Ready |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| P1 fría | 2336.2 (2296.1–2354.1) | 80.6 (80.3–81.3) | — | — | — | 2197.4 (2155.6–2215.1) |
| P1 caliente | 412.1 (407.9–417.5) | 7.4 (7.4–10.3) | — | — | — | 400.0 (398.7–408.1) |
| P2 fría (M-2 final) | 16358.3 (16119.7–16504.8) | 916.9 (863.8–958.2) | 68.9 (63.5–74.2) | 10951.1 (10838.2–11069.8) | 4449.2 (4249.1–4479.8) | 4439.1 (4234.9–4465.5) |
| P2 caliente (M-2 final) | 14380.5 (14199.2–14781.1) | 890.2 (886.2–923.1) | 10.4 (10.3–13.1) | 10608.6 (10577.8–10748.1) | 2875.3 (2687.9–3129.7) | 2872.2 (2686.7–3127.6) |

Filas individuales de las sesiones aceptadas (ms; `—` = tramo ausente):

| Corrida | Condición | Importado→Ready | Importado→Parsed | OCR | OCR→Ready | NER→Ready | `runInferenceInBatches` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| p1-run0 | fría | 2296.1 | 81.3 | — | — | 2155.6 | — |
| p1-run0 | caliente | 412.1 | 10.3 | — | — | 400.0 | — |
| p1-run1 | fría | 2336.2 | 80.6 | — | — | 2197.4 | — |
| p1-run1 | caliente | 407.9 | 7.4 | — | — | 398.7 | — |
| p1-run2 | fría | 2354.1 | 80.3 | — | — | 2215.1 | — |
| p1-run2 | caliente | 417.5 | 7.4 | — | — | 408.1 | — |
| p2-run0 | fría | 16119.7 | 958.2 | 10838.2 | 4249.1 | 4234.9 | 4223.2 |
| p2-run0 | caliente | 14199.2 | 923.1 | 10577.8 | 2687.9 | 2686.7 | 2675.2 |
| p2-run1 | fría | 16504.8 | 916.9 | 11069.8 | 4449.2 | 4439.1 | 4426.5 |
| p2-run1 | caliente | 14380.5 | 886.2 | 10608.6 | 2875.3 | 2872.2 | 2860.3 |
| p2-run2 | fría | 16358.3 | 863.8 | 10951.1 | 4479.8 | 4465.5 | 4452.6 |
| p2-run2 | caliente | 14781.1 | 890.2 | 10748.1 | 3129.7 | 3127.6 | 3115.6 |

En P2 el error de cierre de cada corrida fue menor o igual a 5 ms para:

`importado→Ready = importado→Parsed + parsed→OCR_STARTED + OCR + OCR_FINISHED→Ready`.

Los controles UI (`UI import start→DOCUMENT_IMPORTED` y
`PIPELINE_READY→panel visible`) están en cada JSON y no se suman al pipeline.

Los conteos P2 fueron constantes entre frío/caliente: 13 entidades y 11
grupos. Tras retener las palabras desde el cache en `OCR_PAGE_FINISHED` y
ordenarlas por página fuera de la ventana medida, las seis huellas OCR dieron
exactamente `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`,
igual a I-1. La huella de detección usa tuplas canónicas de fuente, tipo,
valor normalizado, página y geometría; fue estable en las tres sesiones.

## M-2 y recomendación M-3

El criterio numérico de M-2 se activa: `OCR_FINISHED→PIPELINE_READY` supera
1 s en las tres sesiones de cada temperatura (medianas 4.45 s fría y 2.88 s
caliente). El subtramo observable `NER_STARTED→PIPELINE_READY` explica casi
todo ese intervalo, pero `GROUPING_FINISHED` está anidado por listeners
síncronos y no autoriza restar marcas como si fueran tiempos exclusivos.

M-2 se ejecutó con un patch temporal real en `ner.engine.ts` y
`grouping.engine.ts`, acumulando `inferenceMs`, `entityHandlersMs`,
`groupingNerHandlersMs` y `finishMs` en `globalThis.__anonlyM2`. Tras reconstruir
paquetes, React y Electron, el smoke produjo valores positivos y se hicieron
tres sesiones P2 válidas. Medianas fría/caliente: inferencia NER
`4426.5 / 2860.3 ms`, handlers de Grouping para ocurrencias NER
`1.23 / 0.54 ms`, handlers totales `2.12 / 1.04 ms`, y finalización
`0.27 / 0.07 ms`. Los JSON están en `p2-run*.json`; el smoke y tandas
anteriores inválidas están archivados en `m2-smoke-final/`, `m2-invalid/` y
`pre-*`.

La campaña no forma parte de la corrida normal de `pnpm test:perf`: el spec
queda omitido salvo con `ANONLY_TIME_OUTSIDE_OCR=1` y exige
`ANONLY_TIME_OUTSIDE_OCR_OUTPUT_DIR` apuntando a un directorio nuevo. Ejemplo:

```bash
pnpm assets:mirror
VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
ANONLY_TIME_OUTSIDE_OCR=1 ANONLY_TIME_OUTSIDE_OCR_OUTPUT_DIR=.measure/tiempo-fuera-ocr/new \
  npx playwright test --config=playwright.perf.config.ts tests/perf/time-outside-ocr.spec.ts --repeat-each=3
```

Para repetir M-2, aplicar temporalmente
`tests/perf/support/m2-instrumentation.patch` sobre los dos motores antes
del build y agregar `ANONLY_M2_REQUIRED=1` a la corrida. Restaurar los
archivos y verificar sus hashes contra `m2-before.sha256` al terminar.

Los eventos públicos sí dejan `NER_STARTED→NER_FINISHED` (~4.09–4.45 s fría,
~2.59–2.89 s caliente), `NER_FINISHED→GROUPING_FINISHED` (≈0 ms) y el cierre
hasta `PIPELINE_READY` (≈0 ms), pero son inclusivos. El patch separa la
inferencia acumulada y los handlers sin sumarlos como intervalos exclusivos;
la carga se aproxima con `NER_MODEL_READY` en frío. El patch fue revertido y
los hashes antes/restaurados coinciden en `m2-before.sha256` y
`m2-restored.sha256`.

La recomendación M-3 es priorizar el análisis de NER: `inferenceMs` es una
medición inclusiva de `runInferenceInBatches` (carga/cola/worker), no inferencia
pura. Grouping medido ronda 1 ms y no justifica intervención. No se implementa
optimización hasta separar esos componentes con una segunda instrumentación.

## Gates y límites

- `pnpm format:check`: verde tras formatear el archivo previo
  `tests/perf/margin-i2-probe.spec.ts`.
- `pnpm lint`: verde.
- `pnpm typecheck`: verde.
- `pnpm test`: 2272 tests verdes.
- `pnpm test:contract`: 312 tests verdes.
- Build fresco de React y desktop shell: verde.
- M-1 P1: 3/3 verde; M-1 P2: 3/3 verde con conteos constantes y cierre ≤5 ms.
- Huella OCR P2: 6/6 igual a I-1; huella de detección: 6/6 estable.
- No se midió una serie A/A específica del overhead del colector de tiempo.
  Captura referencias de palabras OCR y serializa 13 eventos de entidades
  durante el pipeline; los hashes se calculan después de `Ready`. Esta
  limitación impide interpretar diferencias de pocos milisegundos como una
  mejora, aunque no cambia la atribución de segundos observada en M-2.
- Las corridas preliminares con P1 generado dentro del test se descartaron:
  el PDF cambiaba SHA entre sesiones. El fixture congelado usado arriba evita
  esa contaminación.
