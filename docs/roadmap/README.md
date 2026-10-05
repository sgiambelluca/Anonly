<!-- CONTEXT: scope=roadmap-indice | dependencias=roadmap/Version_1.0.md,roadmap/Roadmap_1.x.md,roadmap/Version_2.0.md,roadmap/Future_Ideas.md,roadmap/MVP.md,roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md | audiencia=humanos+IA | fase=1.0.1 -->

# Roadmap — cómo está ordenada esta carpeta

Los documentos sueltos son los que hay que leer para saber dónde está el
proyecto y hacia dónde va. Las carpetas guardan el trabajo que llevó hasta
ahí: planes, entregas, revisiones y mediciones. Están cerradas o son de
consulta, salvo que su fila diga otra cosa.

## Lo principal

| Documento | Qué responde |
|---|---|
| [`Version_1.0.md`](./Version_1.0.md) | Qué es la 1.0: qué trae, cómo se midió y qué limitaciones conocidas tiene |
| [`Roadmap_1.x.md`](./Roadmap_1.x.md) | Qué sigue y en qué orden, versión por versión, y qué hay que decidir al llegar a cada una. **Es el documento que manda para planificar** |
| [`Version_2.0.md`](./Version_2.0.md) | Lo que queda para una versión mayor |
| [`Future_Ideas.md`](./Future_Ideas.md) | Ideas sin versión asignada |
| [`MVP.md`](./MVP.md) | Cómo se llegó a la 1.0, hito por hito. Registro histórico: no se sigue actualizando |

## Carpetas

| Carpeta | Qué guarda | Por dónde empezar |
|---|---|---|
| [`hitos/`](./hitos/) | Entregas, revisiones y pendientes de los hitos del MVP, y el informe de calidad de detección | [`Post_Hito10.8_Pendientes.md`](./hitos/Post_Hito10.8_Pendientes.md): varios de sus puntos siguen abiertos y `Roadmap_1.x.md` los cita |
| [`hardening/`](./hardening/) | La revisión previa a la 1.0, planes de gates e inventario de lógica duplicada. **Abierto en 1.0.x:** gate del PDF exportado (ADR-148), primera entrega sin aprobar | [`ADR148_Revision_2026-10-05.md`](./hardening/ADR148_Revision_2026-10-05.md), [`Export_Verificado_ADR148_Plan.md`](./hardening/Export_Verificado_ADR148_Plan.md); histórico: [`Revision_Por_Bloques_Hardening.md`](./hardening/Revision_Por_Bloques_Hardening.md) |
| [`memoria/`](./memoria/) | La campaña de memoria: plan, bitácora, instrumento de medición, `ImageData`, márgenes y PDF pesados | [`Optimizacion_De_Memoria_Plan.md`](./memoria/Optimizacion_De_Memoria_Plan.md) |
| [`rendimiento/`](./rendimiento/) | La campaña de tiempos: perfilados, experimentos, lotes de NER y la revisión que llevó a los perfiles de rendimiento | [`Optimizacion_De_Rendimiento.md`](./rendimiento/Optimizacion_De_Rendimiento.md) |
| [`ocr/`](./ocr/) | Orientación compartida (T5), fiabilidad de lectura (ADR-190) y las campañas de resolución del OCR | [`T5_OSD_Compartido_Cierre_Final.md`](./ocr/T5_OSD_Compartido_Cierre_Final.md) |
| Investigación OCR de imágenes pequeñas (abierta, 1.0.x) | Política de regiones menores que el mínimo de ADR-065, con calidad y memoria; decidida por el humano el 2026-10-05 | [`Regiones_Pequenas_Investigacion_Plan.md`](./ocr/Regiones_Pequenas_Investigacion_Plan.md) |
| Prototipo de mínimo 25 pt (ADR-202, piloto cerrado) | Evidencia/arnés aprobados; mixed recuperado, OCR adicional en capas alineadas; candidato no adoptado, costo no medido | [`Regiones_Pequenas_25pt_Experimento_Plan.md`](./ocr/Regiones_Pequenas_25pt_Experimento_Plan.md) |
| Cierre del gate de export (ADR-203, local y CI verde) | Política 100 pt, mixed elegible versionado y pequeño histórico preservado; 21/21 Windows/macOS, R-16 verde, Sol APPROVED local y CI completa success | [`ADR148_Cierre_ADR203_2026-10-05.md`](./hardening/ADR148_Cierre_ADR203_2026-10-05.md) |
| [`distribucion/`](./distribucion/) | La postulación a SignPath para la firma de código de Windows. **Abierta**: enviada el 2026-10-02 | [`SignPath_Postulacion.md`](./distribucion/SignPath_Postulacion.md) |
| [`mediciones/`](./mediciones/) | Los informes de cada medición, por motor. Cómo correr los arneses: `tests/perf/README.md` | [`mediciones/README.md`](./mediciones/README.md) |

## Convenciones

- Un documento nuevo de trabajo va en la carpeta de su tema. En la raíz solo
  quedan los cinco de arriba y este índice.
- Los documentos de las carpetas se citan desde otros por su ruta completa
  desde `docs/`, por ejemplo `roadmap/hitos/Post_Hito10.8_Pendientes.md`.
- `hardening/Hardening_Revision_2026-09/Manifest.json` es una foto del
  repositorio en la fecha de esa revisión: sus rutas son las de entonces y no
  se actualizan.
