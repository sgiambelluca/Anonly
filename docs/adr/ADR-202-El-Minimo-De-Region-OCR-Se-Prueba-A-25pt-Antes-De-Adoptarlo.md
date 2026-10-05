<!-- CONTEXT: scope=adr-experimental | dependencias=adr/ADR-065-OCR-Por-Region.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,core/PDF_Engine.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md,roadmap/mediciones/ocr/Regiones_Pequenas_2026-10-05.md | audiencia=humanos+IA | fase=12 -->

# ADR-202 — El mínimo de región OCR se prueba a 25 pt antes de adoptarlo

- **Estado:** experimento cerrado; fidelidad, arnés y evidencia aprobados,
  adopción de 25 pt rechazada bajo el criterio de exclusión de trabajo redundante.
- **Fecha:** 2026-10-05.
- **Decidido por:** el humano autorizó investigar el candidato de 25 pt
  después de la caracterización revisada por Sol 6.1.
- **Alcance:** una campaña experimental del mínimo por lado de `pdf-engine`
  y su arnés. No modifica contratos, otros motores ni presupuestos.
- **Relación con ADR-065:** excepción experimental solo a su mínimo de
  100 pt por lado; el resto de la admisión se conserva. La política de
  referencia sigue siendo 100 pt hasta una decisión posterior.

## Contexto

La imagen de 300 × 56 pt del fixture mixed de ADR-148 contiene un DNI
legible que el filtro de 100 pt excluye. La investigación inicial
recuperó el DNI con OCR aislado en 17/17 controles pequeños con original
confirmado, incluidos seis de 25 pt. Trece originales pequeños no quedaron
confirmados por el verificador independiente. Es evidencia para una
hipótesis, no una medición del pipeline con el mínimo reducido.

La misma investigación encontró texto espurio sobre blancos y una entidad
ADDRESS espuria sobre «REGION PUBLICA». El control de capas alineadas
pasó con la política de 100 pt; no se demostró que siga pasando con 25 pt.
Los picos experimentales después de Ready no predicen el pico del
pipeline que ahora admita esas regiones.

## Decisión experimental

1. Construir dos artefactos Electron identificables: referencia de
   **100 pt** y candidato de **25 pt**. La única diferencia intencional
   de runtime es `OCR_REGION_MIN_SIDE_PT` en `pdf-engine`; ambos lados
   del bbox **después del clamp** deben cumplir el mínimo.
2. Conservar área de imagen ≥1% por rectángulo, grilla 64 × 64, dilatación
   nativa 0,5 horizontal/0,8 vertical, área vacía clampeada ≥40%, selección
   de una sola candidata por página y operadores de imagen vigentes.
   No cambiar DPI, pools, Regex/NER, grouping, render ni export.
3. Validar primero la admisión real del mixed, límites de 25 pt y el
   control de capas alineadas. Capturar regiones, palabras, ocurrencias
   y grupos del **pipeline real**. No inyectar entidades ni sustituir
   el pipeline por OCR forzado para declarar un éxito del candidato.
4. Conservar fixtures y resultados de la primera investigación. Los
   nuevos controles son corpus adicionales versionados, iguales en
   ambos brazos. No modificar los dos DNI, geometría ni expectativas
   del mixed de ADR-148 para obtener verde.
5. Si los controles alineados disparan OCR nuevo, el cambio de mínimo
   por sí solo no cumple la hipótesis de conservar exclusión de trabajo
   redundante. Registrar el contraejemplo y detener la campaña larga:
   el planificador decide el siguiente diseño con el humano. No ajustar
   ocupación, corpus ni NER dentro de esta tarea para ocultarlo.
6. Si la primera etapa sostiene la hipótesis, medir el pipeline completo
   en pares referencia/candidato intercalados, con fixtures idénticos,
   Intermedio, NER habilitado y ventanas import/render/export/reposo.
   Verificación independiente fuera de las ventanas Electron.
7. Los techos vigentes se evalúan en sus perfiles canónicos, no sobre
   los documentos sintéticos de bandas: P1 ≤2.000.000.000 bytes y P2
   ≤3.000.000.000 bytes, con tres corridas frías/calientes en Windows
   (ADR-192). No subir el techo ni reducir paralelismo por conveniencia.

## Aprobación y cierre

El experimento puede concluir con una hipótesis rechazada: eso no es una
ambigüedad que el implementador deba resolver cambiando arquitectura.
Una falla mecánica del arnés se corrige antes de interpretar los datos;
una pérdida de calidad o redundancia de un candidato fiel se reporta.

La revisión aprueba o rechaza fidelidad del prototipo, arnés y evidencia
por separado de la adopción del mínimo. El humano decide la política de
producto después de conocer recuperación, falsos positivos y costo.
Un mixed verde en el candidato no aprueba por sí solo ADR-148, ni la
publicación: siguen exigidas su matriz de 21 filas y las validaciones
de producto correspondientes. No hay autorización de commit o push.

El procedimiento, corpus, checks y criterios de parada están en
[el plan de experimento](../roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md).

## Consecuencias

**Cierre posterior ADR-203:** al cerrar el alcance del gate ADR-148, se
restauró 100 pt en el runtime de trabajo y conservó los snapshots
de este experimento. La variante pequeña permanece en caracterización;
el mixed del gate tiene versión elegible nueva. La reversión y los gates
quedaron verificadas localmente: 21/21, R-16 verde y Sol APPROVED local;
CI completa success posterior, run 37383499951. Ver [ADR-203](ADR-203-El-Gate-De-Export-Cubre-La-Politica-OCR-Vigente.md).

### Resultado del experimento, 2026-10-05

Piloto cerrado por parada temprana. Bajo OCR `spa` en ambos brazos, el
candidato recupera y anonimiza el DNI de imagen del mixed con vecinos e
integridad verificados, pero dispara tres ejecuciones OCR nuevas en el
corpus exacto de capas alineadas. H2 queda refutada. No se ejecutaron la
calidad ampliada ni el costo del pipeline/P1/P2 tras esa parada.

Sol 6.1 aprobó fidelidad, arnés y evidencia después de cerrar tres defectos
mecánicos de tests; rechazó la adopción bajo los criterios acordados.
ADR-148 global estaba REJECTED al cierre del piloto; su cierre local posterior
se acredita por ADR-203. La referencia de publicación sigue siendo 100 pt;
el workspace ya fue restaurado y los dos prototipos quedan en snapshots.
La siguiente decisión de diseño corresponde al humano y al planificador.
Ver [el informe revisado](../roadmap/mediciones/ocr/Regiones_Pequenas_25pt_2026-10-05.md).

### Límites del alcance

- El workspace puede contener temporalmente el candidato local de 25 pt,
  claramente identificado en código y builds. No se declara política
  definitiva ni resultado de release a partir de ese estado.
- Las imágenes debajo del 1% y las variantes de pintado excluidas por
  ADR-065 siguen fuera de este camino. Varias imágenes elegibles siguen
  compitiendo por una sola región; no promete eliminar todos sus datos.
- No se añade setting, evento, tipo compartido, dependency ni logging
  de contenido al Core. La observación vive en tests sobre datos sintéticos.
