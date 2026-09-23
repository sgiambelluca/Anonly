<!-- CONTEXT: scope=adr | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,roadmap/PDFs_Pesados_Y_Exportacion_Plan.md,roadmap/PDFs_Pesados_Y_Exportacion_Medicion.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,core/Contracts.md,core/Render_Engine.md,core/Export_Engine.md | audiencia=humanos+IA | fase=11 -->

# ADR-174 — Los PDFs pesados se miden hasta el archivo exportado

- **Estado**: Accepted; banco opt-in implementado y caracterización local completada el 2026-09-23. El código del banco aún no tiene commit.
- **Fecha**: 2026-09-23.
- **Decidido por**: El planificador, para el punto 3 de `roadmap/Optimizacion_De_Memoria_Plan.md` §2ter.
- **Numeración**: ADR-168 a ADR-172 están reservados para otra rama de UI. ADR-174 no ocupa ese rango; en los refs locales y remotos visibles no existe otro ADR-174. Antes de integrar otra rama, resolver cualquier colisión aparecida fuera de los refs visibles.
- **Relacionado con**: ADR-146 (M1/M2), ADR-148 (verificación del export), ADR-153 (Electron empaquetado), ADR-159 (retención del renderer).

## Contexto

P1/P2 y R1/R2 ejercitaron páginas y texto, pero no acotan el costo de un PDF de muchos bytes por página ni el de renderizar y ensamblar un export completo. `EXPORT_FINISHED.sizeBytes` describe la salida, no la memoria transitoria que la produjo. El banco actual mide importación y `Ready`; extrapolarlo a exportación sería una atribución sin evidencia.

El renderer, los workers y pdf-lib pueden mantener copias y rásters que las APIs públicas no enumeran. La suma RSS de Electron cuenta páginas compartidas más de una vez. El heap JS y WASM tampoco incluyen necesariamente backing stores o memoria nativa. Por eso un número de RSS no se puede descomponer por simple resta en “PDF + rásters + ensamblado”.

## Decisión

1. Se agrega una **caracterización opt-in** bajo `tests/perf/`, ejecutada contra el shell Electron empaquetado y los motores reales. El punto 3 no modifica código de producción, contratos, presupuestos de ADR-146, configuración de pools ni la tabla canónica de gates. Una corrección de producto descubierta por el banco será una tarea posterior, separada por módulo.
2. Los casos primarios son PDFs **sintéticos**, versionando el generador y fijando parámetros/semilla. Se generan en un proceso separado que termina antes de lanzar el Electron medido y se cachean solo bajo `.measure/fixtures/`. Se registran SHA-256 y tamaño efectivo; si un fixture deja de cumplir su clase, la corrida falla. No hay documentos reales ni datos personales en este brazo. R1/R2 podrán añadirse después con el protocolo confidencial de T-10, sin guardar PDF, OCR, imágenes, texto ni nombres en los reportes.
3. Cada perfil cubre importación hasta `Ready`, render completo explícito de **todas** las páginas y exportación completa con descarga del PDF final. Las ventanas de memoria son independientes: importar, render completo, exportar y reposo posterior. Se conserva la serie cruda y se informan M2, M1 donde el ciclo frío→cerrar→caliente lo permita, pico posterior a `Ready`, tiempo, presión del sistema y costo de la sonda conforme a ADR-146. El pico de render/export no se llama M2 de importación.
4. Para hablar de copias y buffers se distinguen **bytes conocidos**, **cotas calculadas** y **memoria no observable**. Son conocidos el tamaño del PDF fuente, los bytes codificados por página cuando el evento público los deja ver sin conservarlos, y `EXPORT_FINISHED.sizeBytes`. `ancho × alto × 4` es una cota de un ráster RGBA, no la prueba de que haya una sola copia viva. La capacidad interna del documento de pdf-lib, la multiplicidad de clones, el backing store de cada canvas y la memoria nativa sin atribución permanecen “no observables” salvo una sonda validada. Ningún `null` se reemplaza por cero.
5. El PDF descargado se **abre de nuevo** y se verifica que conserva cantidad y dimensiones de páginas, que cada página se renderiza y contiene la marca visual sintética y el contenido vecino esperado. Se informa hash/tamaño de salida. Esto mide integridad y legibilidad del export; **no sustituye el gate de redacción de ADR-148**, que exige controles OCR positivo y negativo específicos. No se reportará “anonimización segura” a partir de este banco.
6. Se mide una cancelación de exportación después de progreso observable sobre un perfil de varias páginas: no debe llegar `EXPORT_FINISHED` ni quedar descarga disponible. Se usa el evento público `CANCEL_REQUESTED` por el bus desde el hook E2E; `ExportProgress` no ofrece hoy un botón para cancelar una exportación en curso. Si el trabajo concluye antes del punto de cancelación, la prueba se marca no ejercitada, no verde.
7. No se crea un nuevo gate ni un límite de memoria a partir de tres repeticiones. El informe conserva corridas individuales, dispersión y controles intercalados. El planificador decide después, con la evidencia, qué prueba puede estabilizarse como gate y qué costo de producto amerita intervención.

## Condición de implementación

`roadmap/PDFs_Pesados_Y_Exportacion_Plan.md` fija perfiles, fases, campos y aceptación del banco. El implementador puede construir el instrumento y entregar datos, pero no modificar specs de motores ni convertir un hallazgo en cambio de contrato o presupuesto. Si falta una API pública para una medición exacta, informa el límite como “no observable”; no agrega instrumentación de producto por inferencia.

La ejecución local y sus límites están en `roadmap/PDFs_Pesados_Y_Exportacion_Medicion.md`: nueve corridas intercaladas y una cancelación ejercitada, con calidad estructural/visual del export verificada. No se derivó un cambio de presupuesto ni una optimización del producto.

## Consecuencias

El banco producirá evidencia de extremo a extremo sin convertir estimaciones de buffers en asignaciones exactas. La verificación del export puede descubrir fallos de fidelidad; la garantía de ausencia de datos sensibles sigue perteneciendo a ADR-148. Las pruebas pesadas quedan fuera del gate cotidiano mientras no haya una decisión posterior basada en corridas reproducibles.
