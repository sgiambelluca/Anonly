<!-- CONTEXT: scope=cierre-T5 | dependencias=adr/ADR-164-Un-OSD-Compartido-Por-Core.md,roadmap/T5_OSD_Compartido_Revision_Separados.md,roadmap/T5_ImageData_Investigacion.md | audiencia=humano+planificador+revisor | fase=11 -->

# T5 — Cierre de OSD compartido con una página de adelanto

Fecha: 2026-09-15. **Aceptado y cerrado por el planificador tras revisión y
controles finales.** La decisión del humano de conservar el diseño se ratifica:
dos reconocedores LSTM, un OSD por Core y una página adicional en preparación,
bajo el presupuesto de imágenes de 128 MiB. No se exige demostrar ahorro RSS
para conservar la mejora temporal observada.

## Resultado funcional revisado

- Recuperación de OSD por generación; cancelación y drenaje hasta que termine
  el trabajo real, incluso con una sesión rechazada y un productor pendiente.
- Regiones concurrentes con el mismo pageIndex mantienen imagen, orientación
  y orden de salida por descriptor aunque terminen desordenadas.
- Reconstrucción tras liberar recursos y aislamiento entre kernels OSD:
  terminar A no termina el recurso de B. Tesseract simulado en estas pruebas;
  el flujo completo usa Electron/Tesseract real en el E2E siguiente.
- E2E de cinco páginas físicamente giradas 0/90/180/0/270, reanálisis con
  colecciones nuevas y ocurrencias Regex por página/tipo/valor. NER desactivado
  en este fixture: no se presenta como evaluación de recall de NER.
- Redact explícito y comprobación de muestras interiores de las 90 regiones
  sensibles, con geometría derivada del generador e independiente del OCR.
- Conservación externa según ADR-164 §5.1: cinco regiones, precisión y recall
  1,0 en todas. Fuente contra sí misma pasa; negro opaco y blanco opaco fallan
  en todas. Los controles atraviesan la composición de píxeles y la máscara
  reales, con dimensiones y límites verificados, sin catch que oculte errores.

Los cinco pendientes de `T5_OSD_Compartido_Revision_Cierre_Funcional.md` quedan
resueltos. Los informes de rechazo anteriores se conservan como evidencia
histórica, no como estado vigente.

## Controles finales

| Control | Resultado |
| --- | --- |
| `pnpm lint` | PASS global |
| `pnpm typecheck` | PASS global |
| `pnpm exec vitest run --coverage` | 137 archivos, 2193 tests PASS; thresholds por paquete PASS |
| `pnpm test:contract` | 10 archivos, 312 tests PASS |
| `pnpm format:check` | PASS global |
| Build nuevo renderer y shell + E2E T5 Electron, un worker y cero retries | 1 PASS |
| `git diff --check` | PASS |

Cobertura agregada de **todo OCR incluyendo src/worker**: 1436/1531 líneas,
**93,79 %**. Se obtuvo de `coverage/coverage-final.json` con
`istanbul-lib-coverage`. El 96,07 % informado por el implementador corresponde
al directorio `ocr-engine/src` sin agregar su subdirectorio worker (91,93 %);
no era la cobertura de todo el paquete. El umbral requerido sigue cumplido.

Logs definitivos: `.measure/t5-final-gates/lint-accepted.log`,
`typecheck-accepted.log`, `coverage-accepted.log`, `contract-accepted.log`,
`format-accepted.log` y `e2e-final.log`. Los intentos previos fallidos se
conservan con sus nombres originales. La suite general sin cobertura también
pasó previamente con 2193 tests.

Artefactos del E2E independiente final:

- `.measure/t5-e2e/orientation-1789503219893/anonymizado.pdf`.
- `.measure/t5-e2e/orientation-1789503219893/external-regions-144dpi.json`.

La duración del E2E (41,0 s para el comando, 40,4 s para el test) no es una
medición de rendimiento OCR. Esta aceptación acotada no equivale a ejecutar
toda la campaña de hardening ni todos los escenarios E2E/performance/audit de
la tabla general de CI; tampoco declara una release o PR completo listo.

## Ajustes de infraestructura necesarios para verificar el cierre

La pasada general detectó problemas adicionales a los asserts de T5:

1. ESLint recorría `.measure` y scripts de skills locales fuera del proyecto
   TypeScript. Se excluyen únicamente esos directorios de herramientas y
   evidencia, sin excluir código propio ni desactivar reglas. Las nueve
   configuraciones explícitas conservan lint tipado con límite acotado a nueve.
2. Los cuatro generadores que prometen igualdad binaria (50p, dense,
   small-page y 200p) usaban metadata de hora actual de pdf-lib. Se fijan
   CreationDate/ModDate a una fecha sintética; sus tests fuerzan años distintos
   y comprueban igualdad y metadata. Cambia el hash de futuras generaciones,
   no el contenido ni los PDFs congelados usados en las campañas históricas.

Ambos ajustes fueron especificados por el planificador en el handoff antes de
implementarlos. No se borraron snapshots ni se repitieron mediciones hasta
obtener un resultado favorable. Sin cambios adicionales de runtime OCR,
ImageData, DPI o configuración durante este cierre. Sin commit ni push.

## Tiempo, memoria y alcance del cierre

Se conserva la evidencia de la campaña A/B/C separada, sin repetirla:

| Comparación sobre P2 de 50 páginas | Frío | Caliente |
| --- | ---: | ---: |
| OSD/adelanto con el mismo comportamiento histórico de ImageData: A → B | 15,147 → 11,504 s (−24,0 %) | 15,311 → 11,416 s (−25,4 %) |
| Restitución de rotaciones mediante ImageData nativo: B → C | +5,882 s | +6,099 s |

RSS no demuestra ahorro ni equivalencia estadística. El beneficio A→B no se
extrapola sin medir al régimen con las pasadas rotadas restauradas. Los límites
de orden de ejecución, pares RSS excluidos y calidad están en la revisión
separada. El cierre acepta el diseño OSD elegido por el humano, no convierte
estos resultados en ahorro de RAM ni en aceleración universal.

**Trabajo posterior separado:** evaluar y optimizar ImageData. La corrección
nativa permanece en el árbol; este cierre no cambia su costo medido ni decide
que su implementación sea óptima. Partir de la versión funcional, perfilar
preparación/encode/reconocimiento y medir variantes individuales, incluyendo
un caso positivo de sello vertical dentro de una página derecha. Nunca usar
la omisión accidental de texto como baseline de calidad. La investigación
y el protocolo de continuación se documentan aparte.
