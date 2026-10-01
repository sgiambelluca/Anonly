# Informe: campaña DPI descendente, fase 1 (calidad), Windows nativo, 2026-10-01

Commit 5e7c9e8, árbol limpio. Solo IDs neutros, números y agregados (R2 = documento real).
summary.json completo: `.measure/ocr-dpi-down/20261001T194929Z/summary.json` (62 KB).

## Pasos previos
- Humo fase 1 (S10, 300 y 150): sin ABORTA, available:true, armEffective true en las 3 celdas, effectiveDpis = DPI del brazo, tope 301.
  150 no perdió nada en S10 (16/16); línea final con DETENER-CAMPANA=true (condición del humo declarada mal puesta por el humano).
- Humo fase 2 (P2H, 2 rec., 300 y 200): `complete=n/a dpis=[300,200] pools=[2] huellas-a-300-iguales=true salvedades=0`; arrancó bien desde Git Bash (delegó en run-ocr-pool-dpi.sh); effectiveDpis [300] y [200]; reserva/pág 34.809.280 B (300) -> 15.465.468 B (200); páginas en 128 MiB 3 -> 8; Ready 19223 -> 9918 ms, OCR 16240 -> 6988 ms; huellas de OCR a 200 difieren de las de 300 (informado, no juzgado).
- Sonda 2b (S8, SD1, 300 y 150): `complete=true matriz=PARCIAL(9) 150=parcial cobertura=0.95 discriminantControlFailed=false S6-AUSENTE salvedades=1 [s6-ausente]`.
  S8 a 150: 15 detectadas, 14 coinciden, 2 perdidas (EMAIL marina.suarez@example.com, EMAIL contacto.estudio@example.org), 1 agregada (EMAIL suarez@example.com); recall de tokens 0,99792; 0 pasos de recuperación; 0 unreadableInk. S8 a 300: 16/16, recall 1. SD1 a 300 y 150: 16/16, recall 1, 0 recuperación, 0 unreadableInk.

## 1. Línea final (matriz completa)
`complete=true matriz=completa 150=no-pasa 200=no-pasa 250=no-pasa cobertura=0.95 discriminantControlFailed=false no-evaluado=250@R2 salvedades=0`

## 2. Veredictos
| Brazo | Veredicto | Criterios que fallan |
|---|---|---|
| 250 | no-pasa | S8 c2: cobertura mín. 0,9439 < 0,95. SR c1: pierde 10 (EMAILx1, ORGANIZATIONx8, PERSONx1) que 300 detecta. SR c2: cobertura mín. 0,9444. R2: no evaluado (efectivo en 0 de 20 páginas) |
| 200 | no-pasa | SR c1: pierde 9 (EMAILx4, ORGANIZATIONx3, PERSONx2). R2 c1: pierde 24 (ADDRESSx5, ORGANIZATIONx9, PERSONx10). R2 c2: cobertura mín. 0,9487 |
| 150 | no-pasa | S8 c1: pierde 2 (EMAILx2). SR c1: pierde 4 (EMAILx1, ORGANIZATIONx3). SR c2: cobertura mín. 0,9421. R2 c1: pierde 18 (ADDRESSx4, DNIx1, ORGANIZATIONx6, PERSONx7). R2 c2: cobertura mín. 0,8589 |
Sin criterios indeterminados en ningún brazo. SD (80 entidades): los tres brazos pierden 0 y 300 pierde 0 -> `pasa`. S12, S10 y SE: sin pérdidas ni cobertura bajo 0,95 en los tres brazos.
Criterio 3 (cadena ADR-190): sin fallos en ningún brazo.

## 3. Banderas
DETENER-CAMPANA=false. Sin FIXTURE-REGENERADO (fixtureHashMismatches vacío). no-evaluado=250@R2. Sin controlInconsistencies.

## 4. controlIncompleteCorpora
Vacío: 300 no pierde ninguna entidad contra la verdad en ningún corpus sintético (entitiesLostVsTruth 0 en S12, S10, S8, S6, SD1-5, SE, SR). R2 no tiene verdad (null). 300 agrega 15 en SR (ORGANIZATION 13 y PERSON 2 no esperadas).

## 5. Variación del control
controlVariation.overallCoverage: count 497, min=p05=mediana=media=max=1; belowBin todos 0. thresholdBelowControlVariation=false (sin aviso). controlFloor ok:true en todos los corpus. En R2 las dos repeticiones de 300 coinciden (227 de 227).

## 6. S6 (no decide)
Perdidas contra verdad: 150 -> 2 (EMAILx2); 200 -> 2 (CUIT x1, EMAIL x1); 250 -> 0; 300 -> 0. Tokens recall: 150 0,9886; 200 0,9977; 250 y 300 1. Cobertura mín.: 150 0,9545; 200 0,945; 250 0,9322. Paso de recuperación de ADR-190: 1 en los cuatro brazos y en las 2 repeticiones de 300 (OSD 180 sobre página derecha), a su DPI de brazo (150, 200, 250, 300); 0 upscale; 0 unreadableInk. Lo mismo, 1 paso, en SE (página girada 180 a propósito); el resto de los corpus, 0 pasos.

## 7. R2: effectivePages por brazo
Tope de página 201 en las 20 páginas. 300: 0/20; 250: 0/20 (no evaluado; mismo despacho que 300, a 201); 200: 20/20; 150: 20/20. R2 a 150 y 200 se compara contra 300. Entidades de R2 detectadas por tipo: a 300 ADDRESS 28, DATE 9, DNI 1, ORGANIZATION 32, PERSON 157; a 200 ADDRESS 27, DATE 9, DNI 1, ORGANIZATION 31, PERSON 160; a 150 ADDRESS 27, DATE 9, DNI 1, ORGANIZATION 30, PERSON 164. 200 vs 300: expected 227, detected 228, matched 203, missed 24, added 25. Cobertura 150: 21 entidades bajo 0,95.

## 8. Reintentos de ADR-190 con DPI distinto
Ninguno. En las 56 celdas todos los despachos salieron al DPI esperado y con upscale 1 (upscaledDispatches 0).

## 9. SR
- NER reconoció los nombres: 38 PERSON esperadas, 38 coinciden en los cinco brazos/celdas; detectadas 40 (150, 300 rep1, 300 rep2), 39 (250), 38 (200). 13 ORGANIZATION no esperadas a 300 (agregadas).
- Timeouts: no hay en playwright.log; ocrPageFailedDispatches 0 en todas las celdas SR.
- Página en blanco (pág. 19): se despachó OCR, COMPLETED, inkRatio 0, sin unreadableInk, sin fallo.
- Recall de tokens 1 en 300.

## 10. validityCaveats y caveats.json
validityCaveats vacío. No existe caveats.json ni validity.json. sleep-detection.json available:true. invalidCells 0, missingCells 0.

## 11. Duración
Matriz completa: 19:49:29 a 20:16:52 (27 min), 56 celdas; no hubo que relanzar ningún corpus. Sin R3 (ANONLY_REAL_DOC_R3 no definido). Carpeta única 20261001T194929Z.

## 12. R2: contenido de los JSON de celda
Abrí ocr-dpi-down-cell-R2-d200-rep1.json: solo conteos por tipo (detectedByType, entitiesVsReference.totals), distribuciones, huella (fixtureSha256) y metadatos de despacho; syntheticDetail null y truthLostKeys null. Un grep de "ocrWords" y de "value" en los JSON de R2 no devolvió nada, y la ruta/nombre de R2 no aparece en ningún JSON, en campaign.log ni en ocr-dpi-down-run.json.

## Cosas raras (sin interpretar)
- R2: 300 y 250 salen al mismo despacho (tope 201), por eso 250 no se evalúa; las propias 150 y 200 sí despachan a su DPI.
- 150 y 200 detectan MÁS PERSON que 300 en R2 (164 y 160 contra 157).
- En SR, las pérdidas contra 300 no son monótonas con el DPI: 250 pierde 10, 200 pierde 9, 150 pierde 4. Contra la verdad pierden 1 (250), 4 (200) y 1 (150).
- ORGANIZATION: 13 agregadas por 300 en SR sin entidades esperadas de ese tipo.
