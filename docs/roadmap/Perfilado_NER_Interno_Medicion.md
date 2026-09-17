# Perfilado interno de NER — medición A1/B/A2

Fecha: 2026-09-17. Campaña ejecutada con
`bash tests/perf/run-ner-internal-profile.sh`, en primer plano, sobre macOS
arm64 (8 CPU, 8 GiB). El commit observado fue
`0017f8cd9ffae70b34f650f0f200bba6086bc3cd`. No se modificó producto, contrato
ni spec. La única instrumentación fue el patch temporal indicado en el plan.

## Resultado

La campaña es válida para atribuir el costo dominante dentro de NER en estos
fixtures. En P2, `classifyMs` tiene una mediana de 3440.24 ms en frío y
2839.68 ms en caliente; `modelLoadMs` aporta 942.94 ms y 0.18 ms,
respectivamente. `textPrepMs`, `tokenBudgetMs`, `aggregateMs` y el trabajo del
host son pequeños frente a esos componentes. La diferencia B frente al
**promedio de las medianas de A1 y A2** es +183.5 ms en frío y +96.2 ms en
caliente para `nerMs`; queda muy por debajo del componente de clasificación
y se solapa con la dispersión de las corridas de control. El probe no
invalida la atribución, pero esta comparación no aísla su overhead.

La recomendación es cerrar esta campaña como diagnóstico y priorizar una
investigación específica de la llamada de clasificación/modelo. No se decide
una optimización ni un cambio de arquitectura a partir de esta medición.

## Condiciones y evidencia

- P1: `.measure/fixtures/text-10p-frozen.pdf`, SHA-256
  `b96b0c00b645bca1cd991deb248f499da132155723e96c8144f35bfd4c5a9824`.
- P2: `.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`, SHA-256
  `26f7f910b7af53a085d6d307c5835b85bff9150a870755cea63e21742cc2b08f`.
- Salida completa: `.measure/ner-internal/20260917T135810Z/`.
- Manifiestos: `a1-baseline/manifest.json`, `b-probe/manifest.json` y
  `a2-baseline/manifest.json` dentro de esa salida.
- JSON crudos: cada fase contiene `p1-*run{0,1,2}.json` y
  `p2-*run{0,1,2}.json`; los seis logs Playwright reportan `3 passed`.
- El build normal A1/A2 tiene digest de assets
  `49377d3911f224f98f757de2014c3cd5a45518cb5d5048f142a765368b565b58`.
  El build B instrumentado tiene digest
  `5d9d61b2669015c73df14eabc1cd7988bed18a3c4ebbeb939eab093874bbc411`.
- El patch aplicado está identificado por
  `instrument.sha256`: `a737af97b212d533da509ad8659ecf8955edd5b2b44ffb707d860b2e9a69a899`.

## Todas las filas de sesión

Duraciones en ms. `ner` es `NER_STARTED→NER_FINISHED`; `ready` es
`DOCUMENT_IMPORTED→PIPELINE_READY`; `lotes` es el número de lotes observados
por el probe.

| fixture | fase | corrida | temperatura | ner | ready | entidades | grupos | lotes |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| p1 | A1 | 0 | fría | 2311.2 | 2480.0 | 14 | 14 | — |
| p1 | A1 | 1 | fría | 2150.9 | 2288.0 | 14 | 14 | — |
| p1 | A1 | 2 | fría | 2075.4 | 2217.1 | 14 | 14 | — |
| p1 | A1 | 0 | caliente | 407.9 | 420.3 | 14 | 14 | — |
| p1 | A1 | 1 | caliente | 404.3 | 420.2 | 14 | 14 | — |
| p1 | A1 | 2 | caliente | 403.0 | 412.8 | 14 | 14 | — |
| p1 | B | 0 | fría | 2121.1 | 2269.2 | 14 | 14 | 10 |
| p1 | B | 1 | fría | 2123.1 | 2266.0 | 14 | 14 | 10 |
| p1 | B | 2 | fría | 2054.0 | 2199.4 | 14 | 14 | 10 |
| p1 | B | 0 | caliente | 409.1 | 418.1 | 14 | 14 | 10 |
| p1 | B | 1 | caliente | 409.2 | 418.7 | 14 | 14 | 10 |
| p1 | B | 2 | caliente | 407.8 | 426.2 | 14 | 14 | 10 |
| p1 | A2 | 0 | fría | 2230.8 | 2556.9 | 14 | 14 | — |
| p1 | A2 | 1 | fría | 2229.2 | 2375.4 | 14 | 14 | — |
| p1 | A2 | 2 | fría | 2086.8 | 2238.1 | 14 | 14 | — |
| p1 | A2 | 0 | caliente | 433.9 | 444.6 | 14 | 14 | — |
| p1 | A2 | 1 | caliente | 429.5 | 438.8 | 14 | 14 | — |
| p1 | A2 | 2 | caliente | 427.4 | 437.5 | 14 | 14 | — |
| p2 | A1 | 0 | fría | 4151.8 | 16105.4 | 13 | 11 | — |
| p2 | A1 | 1 | fría | 3999.4 | 15856.5 | 13 | 11 | — |
| p2 | A1 | 2 | fría | 4134.7 | 16000.7 | 13 | 11 | — |
| p2 | A1 | 0 | caliente | 2546.8 | 14029.5 | 13 | 11 | — |
| p2 | A1 | 1 | caliente | 2621.8 | 14123.7 | 13 | 11 | — |
| p2 | A1 | 2 | caliente | 2646.7 | 14003.2 | 13 | 11 | — |
| p2 | B | 0 | fría | 4444.5 | 17299.1 | 13 | 11 | 50 |
| p2 | B | 1 | fría | 4478.4 | 16553.2 | 13 | 11 | 50 |
| p2 | B | 2 | fría | 4389.2 | 16355.4 | 13 | 11 | 50 |
| p2 | B | 0 | caliente | 2781.0 | 14859.2 | 13 | 11 | 50 |
| p2 | B | 1 | caliente | 2879.3 | 14526.6 | 13 | 11 | 50 |
| p2 | B | 2 | caliente | 2872.5 | 15303.0 | 13 | 11 | 50 |
| p2 | A2 | 0 | fría | 4305.6 | 16066.6 | 13 | 11 | — |
| p2 | A2 | 1 | fría | 4436.9 | 16628.1 | 13 | 11 | — |
| p2 | A2 | 2 | fría | 4387.2 | 16401.6 | 13 | 11 | — |
| p2 | A2 | 0 | caliente | 2823.7 | 14422.5 | 13 | 11 | — |
| p2 | A2 | 1 | caliente | 2997.6 | 14750.6 | 13 | 11 | — |
| p2 | A2 | 2 | caliente | 2930.7 | 14681.3 | 13 | 11 | — |

## Mediana y rango por fase

| fixture/fase | temperatura | ner mediana (rango) | ready mediana (rango) |
|---|---|---:|---:|
| P1 A1 | fría | 2150.9 (2075.4–2311.2) | 2288.0 (2217.1–2480.0) |
| P1 A1 | caliente | 404.3 (403.0–407.9) | 420.2 (412.8–420.3) |
| P1 B | fría | 2121.1 (2054.0–2123.1) | 2266.0 (2199.4–2269.2) |
| P1 B | caliente | 409.1 (407.8–409.2) | 418.7 (418.1–426.2) |
| P1 A2 | fría | 2229.2 (2086.8–2230.8) | 2375.4 (2238.1–2556.9) |
| P1 A2 | caliente | 429.5 (427.4–433.9) | 438.8 (437.5–444.6) |
| P2 A1 | fría | 4134.7 (3999.4–4151.8) | 16000.7 (15856.5–16105.4) |
| P2 A1 | caliente | 2621.8 (2546.8–2646.7) | 14029.5 (14003.2–14123.7) |
| P2 B | fría | 4444.5 (4389.2–4478.4) | 16553.2 (16355.4–17299.1) |
| P2 B | caliente | 2872.5 (2781.0–2879.3) | 14859.2 (14526.6–15303.0) |
| P2 A2 | fría | 4387.2 (4305.6–4436.9) | 16401.6 (16066.6–16628.1) |
| P2 A2 | caliente | 2930.7 (2823.7–2997.6) | 14681.3 (14422.5–14750.6) |

## Componentes instrumentados en B

Los valores son sumas por corrida de los lotes; se publica mediana y rango de
las tres sesiones. `dispatchMs - workerTotalMs` mezcla espera, transporte y
scheduling. No se presenta como cola pura.

| fixture/temperatura | dispatch | carga modelo | preparación | presupuesto tokens | classify | aggregate | other | host chunk+mapping+emit | residuo NER |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P1 fría | 2115.0 (2047.7–2118.0) | 956.3 (882.9–1008.8) | 0.79 (0.72–0.96) | 5.16 (2.73–7.34) | 1125.6 (1070.9–1128.4) | 1.13 (1.10–2.09) | 0.39 (0.37–0.43) | 1.83 (1.19–2.41) | 3.89 (3.77–4.10) |
| P1 caliente | 406.1 (404.7–406.2) | 0.02 (0.01–0.08) | 0.14 (0.12–0.33) | 0.79 (0.75–1.11) | 402.3 (401.0–403.1) | 0.22 (0.22–0.25) | 0.10 (0.08–0.10) | 0.63 (0.61–0.64) | 2.38 (2.31–2.41) |
| P2 fría | 4430.2 (4375.2–4464.1) | 942.9 (890.4–995.8) | 0.75 (0.69–0.85) | 8.07 (6.92–8.79) | 3440.2 (3377.0–3470.4) | 1.87 (1.79–1.97) | 0.87 (0.72–2.01) | 2.57 (2.21–2.57) | 11.82 (11.74–11.83) |
| P2 caliente | 2859.7 (2768.4–2866.8) | 0.18 (0.16–0.26) | 0.47 (0.46–0.59) | 7.30 (6.52–8.78) | 2839.7 (2745.5–2845.7) | 0.73 (0.58–0.77) | 0.69 (0.56–0.82) | 1.33 (1.25–1.40) | 11.37 (11.33–11.37) |

Todos los lotes tuvieron `subBatchCount=1` y `splitCount=0`: P1 registró
10 lotes por sesión B y P2 registró 50. `otherMs` no fue negativo. La
reconciliación usada fue `nerMs - sum(dispatchMs) - chunkMs - mappingMs -
emitMs`; su residuo mediano fue 3.89/2.38 ms en P1 fría/caliente y
11.82/11.37 ms en P2 fría/caliente. Dentro de cada lote, la suma de carga,
preparación, presupuesto, clasificación, agregación y `otherMs` se mantuvo
consistente con `totalMs` dentro del redondeo de `performance.now()`.

## Calidad y estabilidad

Las 36 filas conservaron los conteos esperados: P1 tuvo 14 entidades y 14
grupos; P2 tuvo 13 entidades y 11 grupos. Las huellas fueron iguales en frío y
caliente y en las tres fases:

- P1: quality fingerprint
  `166fca2deb53841cf35c919e454fc9b46aa6fbe983904a126559491eaba11304`;
  detection fingerprint
  `dc18409fc585e3f20b1c5c63072bab85172df684e3ea6ae523f28b159bc68b92`.
- P2: quality fingerprint
  `57ebc2ad59ef8e2e9df46f4e8654b9b612ed4bb2d8303c06f921541cfc4b42f2`;
  OCR fingerprint
  `c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`;
  detection fingerprint
  `327c988dd2622c4fd69b47a37d424b7704e2ec92449ada99834323de39abf9c8`.

No hubo `PIPELINE_FAILED`; todas las pruebas terminaron en
`PIPELINE_READY`. Los tiempos P2 son más variables que P1: en B el rango de
`nerMs` es 89.2 ms frío y 98.3 ms caliente. Los rangos A1/A2 son del mismo
orden, por lo que una diferencia aislada entre sesiones no permite atribuir un
cambio al probe.

## A1/B/A2 y límites

Para P2, el promedio de las medianas de A1 y A2 es 4260.9 ms fría y
2776.3 ms caliente; B queda en 4444.5 ms y 2872.5 ms, diferencias de
+183.5 ms y +96.2 ms, calculadas antes de redondear. La mediana de las seis corridas A combinadas sería
4228.7/2735.2 ms; se muestra el promedio de medianas para dar el mismo
peso a cada fase de control. En P1 las diferencias B frente a ese promedio
son −68.9 ms fría y −7.9 ms caliente. La dispersión observada impide
atribuir causalmente esas diferencias al costo del probe, aunque están muy
por debajo de los segundos que explica `classifyMs`.

La instrumentación mide duraciones locales del host y del worker con relojes
de origen distinto. `classifyMs` incluye la tokenización interna de
Transformers.js y ONNX; `modelLoadMs` incluye la carga observada por el worker.
`dispatchMs - totalMs` no separa cola, transporte y scheduling. El corpus es
un P1 de 10 páginas nativas y un P2 de 50 páginas escaneadas; no establece
generalización a otros modelos, idiomas, hardware o documentos. La huella
confirma igualdad en estos corpus, no recall general.

## Restauración y gates

El runner conservó snapshots en `snapshot/ner.engine.ts` y `snapshot/kernel.ts`,
restauró ambos archivos y verificó byte a byte. `source-before.sha256` y
`source-restored.sha256` son idénticos:

```text
c18bf83e53804853a5ea8f4615e24c33a7656b30b786576620aa902a67dc7b62  packages/anonymization-core/ner-engine/src/ner.engine.ts
8de65055203dc96f2bd82ca2f8df81f5ebe24768d1c609bac6e116b6a0c04bfb  packages/anonymization-core/ner-engine/src/worker/kernel.ts
```

El runner reconstruyó el build normal después de restaurar. `pnpm lint` y
`pnpm typecheck` terminaron verdes. Los builds de cada fase también terminaron
verdes y los seis logs Playwright reportan 3/3 pruebas pasadas. No se ejecutó
commit ni push.
