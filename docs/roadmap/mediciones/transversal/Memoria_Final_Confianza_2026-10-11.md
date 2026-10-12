<!-- CONTEXT: scope=memoria-final-confianza | dependencias=adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,architecture/07_Performance_Strategy.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,tests/perf/README.md | audiencia=humanos+IA | fase=1.0.x -->

# Memoria final de Confianza — Windows, 2026-10-11

**Resultado: P1 y P2 cumplen ADR-192.** Producto final del PR #63, commit
`f1fdabb7f1e08c55aeeff24383b772e38f54c1ca`, con árbol limpio. El mantenedor
pidió medir M2 y hacer merge si todo estaba bien. Sol validó los nueve crudos,
guardas y seis documentos y dio APPROVED para registrar la evidencia e
integrar el PR una vez verdes los checks del HEAD resultante.

## Procedimiento e identidad

Windows nativo x64, mirror y build fresco del renderer con `VITE_E2E=1` y
del shell. Nivel `medium` fijado por el arnés (ADR-194 §8), una instancia
nueva de Electron por test y ejecución serial. Tres repeticiones de P1, P2
y P2-dense: nueve tests, dieciocho importaciones frías/calientes, sin fallos,
salteados ni flaky. Duración del runner: 422,3 segundos, unos siete minutos.

```bash
pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/memory.spec.ts --repeat-each=3 --grep 'P1 —|P2 —|P2-dense —' --workers=1 --retries=0
```

P2-200 es opt-in de investigación y queda fuera de esta tanda. Los nueve
reportes anteriores se copiaron antes de ejecutar, a
`.measure/m2-final-20261011-v1-previous/`. La campaña nueva, logs, crudos y
auditoría quedan en `.measure/m2-final-20261011-v1/`, fuera del repositorio
publicable. Los fixtures son los sintéticos normativos, sin documentos reales.

El wrapper confirmó HEAD y árbol limpio al inicio/cierre, identidad de ambos
builds sin cambios, prevención de suspensión activa, detección positiva en
ambos bordes y ninguna suspensión observada. Digests del build:

- Renderer: `e67f16d7c750fb39f894d613f6120a1263654b6bf5e1d39f18f089cc765d7574`.
- Shell: `53c068169d99947fbc329cc473bfb6a636a719f8352967820145f847fccaed96`.

Los JSON locales omiten `identity.commit`: ese campo opcional se toma de
`GITHUB_SHA`, ausente en esta ejecución. La atribución al commit procede del
wrapper y sus comprobaciones de HEAD, fuentes y build. La primera auditoría
adicional trató erróneamente ese campo como obligatorio y reportó nueve
incidencias de identidad; se conserva como
`audit-initial-optional-sha-check.json`. La auditoría corregida respeta el
contrato, rechaza un SHA explícito contradictorio y exige las comprobaciones
del wrapper; terminó sin incidencias. No se modificaron crudos ni instrumento.

## M2 dentro de fases

MB decimales. M2 suma el working set del árbol de procesos de Electron
dentro de la ventana de fases (ADR-146 §7ter). Se compara el máximo de las
seis importaciones de cada perfil, sin promediar fallos.

| Perfil | Frío, tres corridas (MB) | Caliente, tres corridas (MB) | Máximo | Techo | Margen | Resultado |
|---|---|---|---:|---:|---:|---|
| P1, texto y NER, 10 páginas | 1600,7 / 1606,3 / 1568,9 | 1291,0 / 1276,7 / 1301,9 | 1606,3 | 2000 | 393,7 | **Cumple** |
| P2, OCR y NER, 50 páginas | 2091,2 / 2190,2 / 1935,0 | 2755,1 / 2787,9 / 2820,1 | 2820,1 | 3000 | 179,9 | **Cumple** |
| P2-dense, informativo | 2321,0 / 2282,3 / 2452,8 | 2688,6 / 2679,7 / 2712,8 | 2712,8 | Sin techo | — | Informativo |

Las dieciocho importaciones terminaron en Ready y `ok=true`, con M2 disponible
y muestras RSS. Se preservan 3001 muestras. Ningún máximo global fue anterior
a la importación; cuatro fueron posteriores a la última fase, posición válida
según ADR-146 §7ter. Los checks de grupos del spec también pasaron.

## Pico posterior a Ready y límites

El trabajo posterior a la última fase se reporta aparte, sin mezclarlo con M2.

| Perfil | Posterior a Ready, frío (MB) | Posterior a Ready, caliente (MB) |
|---|---|---|
| P1 | 1480,7 / 1500,0 / 1472,2 | 1323,8 / 1304,1 / 1312,8 |
| P2 | 1986,3 / 1966,2 / 2025,3 | 1995,2 / 2110,4 / 2100,8 |
| P2-dense | 2210,8 / 2185,9 / 2278,9 | 2169,5 / 2344,2 / 2311,6 |

La presión por importación no está disponible en Windows en este lector:
las 36 observaciones de borde la declaran desconocida, nunca cero. Las
capturas externas y guardas se conservan junto a los crudos. El margen P2,
179,9 MB, sigue por debajo del ruido histórico de unos 345 MB; esta tanda
acredita cumplimiento del techo y no una mejora de memoria.

M2 queda medido para este producto. La repetición de otras campañas
provisionales sobre el commit sigue como obligación distinta antes del release.
SV/CP continúa como único desarrollo diferido de Confianza hasta disponer de
más escaneos; «Validar muestra» permanece retirada.
