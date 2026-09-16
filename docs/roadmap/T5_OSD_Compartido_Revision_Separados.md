<!-- CONTEXT: scope=revision-T5-separados | dependencias=roadmap/T5_OSD_Compartido_Resultados_Separados.md,roadmap/T5_OSD_Compartido_Handoff.md,adr/ADR-164-Un-OSD-Compartido-Por-Core.md | audiencia=humano+planificador+implementador | fase=11-aceptacion-pendiente -->

# T5 — Revisión independiente de la campaña A/B/C

> **Decisión posterior del humano (2026-09-15):** conservar OSD compartido con
> una página de adelanto por su mejora temporal, aunque no se pruebe ahorro de
> memoria. La revisión funcional pendiente sigue vigente. ImageData se evalúa
> separadamente en [su investigación](T5_ImageData_Investigacion.md); el carácter
> de candidato de la conclusión histórica siguiente ya no implica volver a
> decidir si conservar OSD compartido.

Fecha: 2026-09-15. Revisión de métricas por el planificador y revisión
independiente de código/tests por el revisor. Sin cambios de producto, sin
repetir benchmarks ni modificar los datos históricos.

**Resultado:** los datos separan una mejora de tiempo de OSD compartido con
adelanto de un costo adicional al restituir el reconocimiento rotado.
**REJECTED para cierre funcional:** queda un defecto reproducible en dispose
y pruebas de aceptación insuficientes. No hay ahorro global de RSS demostrado.

## Identidad comprobada

Directorio fuente:
`.measure/t5-osd/t5-20260915-separated-20260915-105519/`.

- A: control original, dos LSTM y dos OSD, dos consumidores, ImageData
  estructural histórico.
- B: dos LSTM, un OSD, hasta tres consumidores, mismo comportamiento histórico
  de ImageData. Correcciones de ciclo de vida constantes antes de medir.
- C: B más ImageData nativo y copia estable de su buffer.

Los hashes de las fuentes capturadas de OCR host/OSD/app son idénticos entre
B y C; solo cambia kernel.ts. Contrasté los snapshots B y final-C: el diff
introduce el helper y sustituye los retornos de rotateImageData/cropImageData.
Los hashes C coinciden con el árbol actual y el build presente. Los cuatro
archivos del instrumento registrados mantienen hash idéntico en las doce
sesiones. Fixture, assets y configuración declarada se conservan.

El archivo llamado `manifests/image-data.diff` contiene el diff acumulado
contra HEAD, incluido OSD; no es por sí mismo el diff aislado B→C. El diff
entre snapshots sí permite verificar la separación real.

## Métricas recalculadas

Usé JSON originales, tiempos OCR de `phases.OCR_FINISHED - OCR_STARTED`,
Ready de `totalMs` y máximos de suma simultánea de las muestras RSS.
Cada media temporal representa tres pares y temperaturas separadas.

| Comparación | Temperatura | Antes → después OCR | Delta OCR | Antes → después Ready |
| --- | --- | ---: | ---: | ---: |
| A → B: OSD compartido + adelanto | Frío | 15.147 → 11.504 s | −3.643 s (−24.0%) | 20.226 → 16.694 s |
| A → B: OSD compartido + adelanto | Caliente | 15.311 → 11.416 s | −3.895 s (−25.4%) | 19.301 → 14.933 s |
| B → C: corrección ImageData/rotado | Frío | 11.601 → 17.483 s | +5.882 s (+50.7%) | 16.802 → 22.620 s |
| B → C: corrección ImageData/rotado | Caliente | 11.361 → 17.461 s | +6.099 s (+53.7%) | 14.782 → 20.872 s |

La dirección temporal se repite en todos los pares. La dispersión alta del
RSS no debe describirse como si volviera inconclusa también esa dirección
temporal. En frío, B−A oscila entre −3.562 y −3.753 s; caliente entre −3.533 y
−4.181 s. C−B cuesta +5.548 a +6.074 s frío y +5.969 a +6.290 s caliente.

### Memoria

| Comparación | Pares RSS válidos | Delta pico OCR frío / caliente | Delta pico global frío / caliente |
| --- | --- | ---: | ---: |
| B−A | 1, 2, 3 | −3.0 / +59.6 MB | +153.5 / +51.5 MB |
| C−B | 1, 3 | +34.1 / +216.9 MB | +32.6 / +184.4 MB |

MB decimales. AB tiene ok/peakWithinPhases válidos y hotBaselineSettled=true
en caliente. BC/B2 tiene peakWithinPhases=false en frío y caliente: excluir
ese par de las medias RSS, conservando sus timestamps para el análisis
temporal. La dirección temporal permanece igual usando solo pares 1 y 3.

En AB los deltas RSS cambian de signo entre pares; no hay ahorro resuelto.
No sumar los picos entre etapas ni inferir tamaño WASM restando heaps V8.

### Calidad y actividad

Recalculé las huellas desde Word[] completas de los 24 imports: todas
coinciden, 50 páginas/1038 palabras y SHA-256
`c723daceea3c72c17bcc4b0594569cad97835b8438d2e7f3ceb636d72cd82f49`.
Se conservan confianza, cajas, rotación y orden interno por página. No prueba
entidades normalizadas ni reconocimiento de texto rotado ausente del P2.

En BC la suma de tiempo de servicio de los jobs LSTM pasa de ~21.0 a ~33.0 s
frío y de ~20.9 a ~33.3 s caliente; OSD permanece alrededor de 6.9–7.1 s.
El adelanto mantiene solapamiento OSD con dos LSTM activos (~5.8–5.9 s por
import); la ocupación agregada LSTM de C es 94.3–95.2%. Son tiempos de jobs,
no CPU ni tiempo puro dentro de Tesseract. El diagnóstico de pasadas se
apoya en el fallo ImageData reproducido y la revisión del código/píxeles;
no se agregó un contador de llamadas internas durante esta campaña.

## Límites y correcciones al reporte

1. **BC no ejecutó la inversión de orden declarada.** Los timestamps muestran
   B1→C1, **B2→C2**, B3→C3: B2 comienza 14:17:25 UTC y C2 14:20:13 UTC.
   El informe dice C2/B2. AB sí respeta su inversión. La falta de inversión
   es una limitación del control de variación temporal, no borra el diff
   aislado ni los deltas consistentes; no afirmar cumplimiento total del
   protocolo.
2. Algunas celdas RSS de BC/par1 no coinciden con los JSON: frío OCR −11.9 MB
   y global −159.0 MB; caliente OCR +188.5 MB y global +123.4 MB. Las medias
   válidas finales publicadas sí coinciden con el recálculo.
3. Comparar C de BC con A de AB da, como referencia entre etapas, ~2.34 s
   adicionales frío y ~2.15 s caliente (aproximadamente +15.4% y +14.0%).
   No es un par A/C contemporáneo ni se obtiene sumando porcentajes. El
   objetivo del humano de no hacer más lenta la versión completa todavía no
   queda cumplido frente a ese control histórico.
4. AB mide el beneficio del scheduling con el trabajo histórico, donde fallan
   las rotaciones. No extrapolar su −24/25% al producto con márgenes reparados:
   falta medir OSD duplicado con esa misma reparación para cuantificar el
   efecto del scheduling en ese otro régimen. La corrección funcional no se
   debe retirar silenciosamente para obtener un benchmark favorable.

## Revisión de implementación

**Avances verificados:** releaseIdleWorkers ahora cuenta ramas activas y no
libera los pools con un productor pendiente después de rechazar la sesión.
La prueba de ventana usa cuatro requests y comprueba que el cuarto espera.
Mejoran las pruebas de presupuesto/retry, cancelación y lowResource. La
recuperación de generaciones OSD sigue corregida.

**P1 — dispose aún ignora ramas activas en su salida rápida.**
`ocr.engine.ts:961–965`, waitForNoActivePages, comprueba páginas y sesiones,
pero no activeProcessBranches. Tras rechazo temprano de la sesión, si queda
un productor pendiente y no hay processPage activo, dispose resuelve y libera
servicios antes de que ese productor/reserva se asiente. Repro del revisor:

```text
sessionRejected OCR_MODEL_MISSING
after releaseIdleWorkers { stillProducing: true, releaseCount: 0 }
after await dispose { stillProducing: true, releaseCount: 2 }
```

El primer método está corregido; el segundo no completa el contrato de
limpieza local. No se afirma que se mate un LSTM ocupado: la disposición se
da por terminada con trabajo y memoria temporal locales pendientes.

**Aceptación E2E pendiente:** t5-orientation-pixel.spec.ts conserva muestras
basadas en las cajas OCR, sin ground truth geométrico independiente; no
selecciona Redact explícitamente y acepta algún píxel cambiado entre cinco
muestras. No verifica cada caja/orientación ni zonas externas. Desactiva NER
y no compara conjuntos normalizados de entidades. El reanálisis real sí se
ejecuta, pero no sustituye esas verificaciones. El informe reconoce parte de
esta limitación; el PASS del test no significa aceptación completa.

**Pruebas de identidad/reconstrucción insuficientes:** la prueba unitaria de
reanálisis solo llama release después de una operación; las regiones de
pageIndex repetido se procesan secuencialmente, no con terminación desordenada;
dos pools que devuelven ángulos constantes no verifican aislamiento del estado
OSD ni que liberar uno preserve al otro. Deben ejercitar los casos 31/38.

El revisor ejecutó 25 tests de orientación y T5: 25/25 PASS. No se repitieron
gates globales ni benchmarks: los defectos demostrados ya impiden cerrar T5.

## Conclusión de planificación

OSD compartido con una página de adelanto sigue siendo un candidato útil para
reducir tiempo. El costo adicional ahora está localizado en la corrección que
restituye reconocimiento rotado y sus copias, no en un fallo del adelanto.
La campaña no demuestra una mejora de memoria. Mantener separados ambos
cambios y sus resultados; completar dispose y aceptación funcional antes de
cerrar T5. C queda en el árbol como candidato, no aceptado como versión final.
