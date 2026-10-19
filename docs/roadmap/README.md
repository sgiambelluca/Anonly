<!-- CONTEXT: scope=roadmap-indice | dependencias=roadmap/Plan_1.1.md,roadmap/Version_1.0.md,roadmap/Roadmap_1.x.md,roadmap/Version_2.0.md,roadmap/Future_Ideas.md,roadmap/MVP.md,roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md,roadmap/interaccion/Mejoras_Interaccion_2026-10-05.md,adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md,adr/ADR-206-Una-Busqueda-Omitida-No-Confirma-La-Version.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/hardening/Validar_Muestra_Diseno_2026-10-09.md,roadmap/mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md | audiencia=humanos+IA | fase=1.0.1 -->

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
| [`Plan_1.1.md`](./Plan_1.1.md) | La 1.1: decisiones del mantenedor, ADR-219 a ADR-224 (aceptados), qué falta antes de implementar y los frentes |
| [`Version_2.0.md`](./Version_2.0.md) | Lo que queda para una versión mayor |
| [`Future_Ideas.md`](./Future_Ideas.md) | Ideas sin versión asignada |
| [`MVP.md`](./MVP.md) | Cómo se llegó a la 1.0, hito por hito. Registro histórico: no se sigue actualizando |

El único punto abierto que se conservará en 1.0.x — Confianza es
[SV/CP ante orientación equivocada](./ocr/Orientacion_SV_CP_Retoma_2026-10-10.md),
en estado **pendiente de desarrollo**, por decisión humana del 2026-10-10.
Se retoma al disponer de más PDF escaneados. Los demás trabajos del cierre siguen su estado en
[Confianza_Cierre_2026-10-08.md](./hardening/Confianza_Cierre_2026-10-08.md)
hasta terminar implementación, validaciones y revisión.

## Carpetas

| Carpeta | Qué guarda | Por dónde empezar |
|---|---|---|
| [`hitos/`](./hitos/) | Entregas, revisiones y pendientes de los hitos del MVP, y el informe de calidad de detección | [`Post_Hito10.8_Pendientes.md`](./hitos/Post_Hito10.8_Pendientes.md): varios de sus puntos siguen abiertos y `Roadmap_1.x.md` los cita |
| [`hardening/`](./hardening/) | Planes de gates e inventario de lógica duplicada. ADR-148 tiene cierre aprobado de 21 casos; la campaña actual incorpora RC y amplía el gate a 23; «Validar muestra» fue retirada | [`Confianza_Cierre_2026-10-08.md`](./hardening/Confianza_Cierre_2026-10-08.md); cierre histórico: [`ADR148_Cierre_ADR203_2026-10-05.md`](./hardening/ADR148_Cierre_ADR203_2026-10-05.md) |
| [`memoria/`](./memoria/) | La campaña de memoria: plan, bitácora, instrumento de medición, `ImageData`, márgenes y PDF pesados | [`Optimizacion_De_Memoria_Plan.md`](./memoria/Optimizacion_De_Memoria_Plan.md) |
| [`rendimiento/`](./rendimiento/) | La campaña de tiempos: perfilados, experimentos, lotes de NER y la revisión que llevó a los perfiles de rendimiento | [`Optimizacion_De_Rendimiento.md`](./rendimiento/Optimizacion_De_Rendimiento.md) |
| [`ocr/`](./ocr/) | Orientación compartida (T5), fiabilidad de lectura (ADR-190) y las campañas de resolución del OCR | [`T5_OSD_Compartido_Cierre_Final.md`](./ocr/T5_OSD_Compartido_Cierre_Final.md) |
| Investigación OCR de imágenes pequeñas (caracterización histórica) | Calidad y memoria bajo ADR-065; piloto de 25 pt no adoptado y política de 100 pt conservada por ADR-203. Las regiones pequeñas siguen siendo una limitación conocida | [`Regiones_Pequenas_Investigacion_Plan.md`](./ocr/Regiones_Pequenas_Investigacion_Plan.md), [`ADR148_Cierre_ADR203_2026-10-05.md`](./hardening/ADR148_Cierre_ADR203_2026-10-05.md) |
| Prototipo de mínimo 25 pt (ADR-202, piloto cerrado) | Evidencia/arnés aprobados; mixed recuperado, OCR adicional en capas alineadas; candidato no adoptado, costo no medido | [`Regiones_Pequenas_25pt_Experimento_Plan.md`](./ocr/Regiones_Pequenas_25pt_Experimento_Plan.md) |
| Cierre del gate de export (ADR-203, local y CI verde) | Política 100 pt, mixed elegible versionado y pequeño histórico preservado; 21/21 Windows/macOS, R-16 verde, Sol APPROVED local y CI completa success | [`ADR148_Cierre_ADR203_2026-10-05.md`](./hardening/ADR148_Cierre_ADR203_2026-10-05.md) |
| [`interaccion/`](./interaccion/), revisión de ADR-204 (2026-10-07) | El resaltado y la selección sobre el PDF anonimizado, medidos contra la tinta. Validados; hallazgo abierto sobre el repintado de línea | [`Revision_ADR204_2026-10-07.md`](./interaccion/Revision_ADR204_2026-10-07.md) |
| [`distribucion/`](./distribucion/) | La postulación a SignPath para la firma de código de Windows. **Cerrada**: enviada el 2026-10-02 y rechazada (informado el 2026-10-07). Windows sigue sin Authenticode | [`SignPath_Postulacion.md`](./distribucion/SignPath_Postulacion.md) |
| [`mediciones/`](./mediciones/) | Los informes de cada medición, por motor. Cómo correr los arneses: `tests/perf/README.md` | [`mediciones/README.md`](./mediciones/README.md) |

## Campaña de interacción implementada y revisada

[Mejoras de interacción — 2026-10-05](./interaccion/Mejoras_Interaccion_2026-10-05.md):
ocho cambios implementados, incluidos lupa/selección anonimizada y vigencia
del export mediante ADR-204/205. Sol aprobó el candidato completo contra
`origin/develop` el 2026-10-06. Branch `codex/mejoras-interaccion-anonimizado`,
desde develop; publicada en el [PR #53](https://github.com/sgiambelluca/Anonly/pull/53)
hacia develop el 2026-10-06, sin release ni versión asignada.
El estado del PR se registra en el plan.
Los tres ajustes posteriores (salida del toast, búsqueda omitida en
desarrollo y arrastre desde blanco) también quedaron implementados y
aprobados por Sol, con ADR-206 y enmienda de ADR-204. El cierre incluye
retirada completa de foco y acciones del toast saliente.

## Avisos y novedades (1.0.2, implementado y revisado)

[Avisos y novedades — 2026-10-08](./interaccion/Avisos_Y_Novedades_2026-10-08.md):
el diálogo del aviso de espacio justo, la confirmación de "Eliminar entidad"
y el menú "Novedades" del pie de inicio. Aprobados por el humano sobre un
lienzo de diseño el 2026-10-08, con ADR-215 y ADR-216. Salen en la 1.0.2.
Branch `feat/avisos-y-novedades`, desde develop; aprobada por el revisor en
la segunda entrega. El registro está en el plan.

## Cierre del bloque de Confianza (aprobado para PR)

[Confianza, cierre del bloque — 2026-10-08](./hardening/Confianza_Cierre_2026-10-08.md):
lo que queda abierto de `Roadmap_1.x.md` §3. RC, el patrón de direcciones y
la ampliación del gate ya están implementados, medidos y aprobados por Sol
para commits, push y PR a `develop` el 2026-10-11. La memoria final pasó
sobre el producto del PR #63: P1 máximo 1606,3 MB y P2 máximo 2820,1 MB,
ambos bajo sus techos. Las repeticiones requeridas de otras mediciones
provisionales sobre el commit siguen pendientes antes del release.
«Validar muestra» se retiró del alcance
el 2026-10-11, por decisión del mantenedor. Branch
`hardening/confianza-cierre`, desde develop. M2 se repitió sobre la base
`develop` del 2026-10-08 y cumplió; la repetición final del 2026-10-11 también
cumplió ([registro](./mediciones/transversal/Memoria_Final_Confianza_2026-10-11.md)).

Retomado en Codex el 2026-10-09: M-O3 terminó el 2026-10-10 con 30/30
corridas válidas, provisionales. La decisión posterior adopta RC y difiere
SV/CP sin adoptar umbral.
El arnés M-V1 pasó sus checks focalizados y dos smoke válidos; su campaña
de 36 se interrumpió al encontrar conflictos que bloquean el export real.
RC aislado terminó 12/12 válido, provisional: el escaneo real de veinte
páginas agrega alrededor de un segundo; diez hojas de ruido, unos veinte.
Ver [costo RC aislado](./mediciones/ocr/Costo_RC_Aislado_2026-10-10.md).
RC fue aceptado el 2026-10-10; SV/CP quedó diferido hasta disponer de más
documentos/escaneos, como único pendiente diferido de esta actualización
([evidencia y retoma](./ocr/Orientacion_SV_CP_Retoma_2026-10-10.md)). La implementación
confirmó el costo en doce corridas nuevas: alrededor de un segundo en R1
y diecinueve con diez hojas de ruido; caracterización M-O1 700/700,
sin cambios inesperados en la proyección registrada.
La reparación de M-V1 pasó un smoke de tres documentos,
incluido R1; la campaña nueva de 36 terminó sobre RC en
`.measure/validate-sample/campaign-20261010-rc-v1`, sin reutilizar el smoke:
30 flujos exitosos y seis lecturas parciales de R4, sin invalidaciones ni
errores de instrumento. La auditoría confirmó guarda, identidad y
restauraciones. El [informe M-V1](./mediciones/transversal/Validar_Muestra_Costo_Lectura_2026-10-10.md)
separa costos de éxito y datos de R4 parcial; la causa de sus páginas OCR
fallidas no quedó registrada en M-V1. El diagnóstico separado v2 confirmó
dos `OCR_PAGE_FAILED` en páginas 1 y 4, sin identificar causa raíz.
La propuesta retirada de «Validar muestra» y el diseño histórico de M-V1 se
conservan en
[`Validar_Muestra_Diseno_2026-10-09.md`](./hardening/Validar_Muestra_Diseno_2026-10-09.md).
No requieren decisiones ni implementación. El gate ampliado
terminó **23/23 localmente, cero fallos/salteados/flaky**, con revisión del
lote APPROVED ([evidencia](./hardening/Export_Gate_Ampliacion_2026-10-10.md)).
El diagnóstico acotado de R4 terminó; conserva su lectura parcial y el
primer instrumento inválido, sin sustituir la matriz histórica.

Los resultados de M-O3 se registran en
[`Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md`](./mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md),
con el estado de validez y los límites de la campaña.

## Convenciones

- Un documento nuevo de trabajo va en la carpeta de su tema. En la raíz solo
  quedan los cinco de arriba y este índice.
- Los documentos de las carpetas se citan desde otros por su ruta completa
  desde `docs/`, por ejemplo `roadmap/hitos/Post_Hito10.8_Pendientes.md`.
- `hardening/Hardening_Revision_2026-09/Manifest.json` es una foto del
  repositorio en la fecha de esa revisión: sus rutas son las de entonces y no
  se actualizan.
