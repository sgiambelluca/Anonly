<!-- CONTEXT: scope=roadmap-indice | dependencias=roadmap/Optimizacion_De_Rendimiento.md,roadmap/Optimizacion_De_Memoria_Plan.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# Mediciones

Informes de medición y de resultados de las campañas de rendimiento y
memoria, agrupados por el motor que se midió. Los planes, *handoffs* y
revisiones de cada campaña quedan en `docs/roadmap/`, junto a los demás
documentos de trabajo. Los arneses que producen estos números están en
`tests/perf/`; cómo correrlos, en [`tests/perf/README.md`](../../../tests/perf/README.md).

| Carpeta | Qué contiene |
|---|---|
| [`ocr/`](./ocr) | `ocr-engine`: reconocedores y pool, OSD compartido, márgenes, `ImageData` en el worker, reproducibilidad entre plataformas |
| [`ner/`](./ner) | `ner-engine`: hilos de ONNX, empaquetado del modelo, perfilado interno, precarga durante el OCR, liberación del modelo |
| [`regex/`](./regex) | `regex-engine`: patrón de email |
| [`grouping/`](./grouping) | `grouping-engine`: búsqueda difusa |
| [`transversal/`](./transversal) | La app entera o varios motores a la vez: memoria del renderer, base caliente, ciclos y documentos reales, PDFs pesados hasta el export, tiempo fuera del OCR, comparativa del banco Windows |

## Índice

| Motor | Informe | Tema |
|---|---|---|
| OCR | [`Reconocedores_OCR_Medicion.md`](./ocr/Reconocedores_OCR_Medicion.md) | Reconocedores OCR LSTM, macOS y Windows nativo |
| OCR | [`OCR_Entre_Plataformas_Medicion.md`](./ocr/OCR_Entre_Plataformas_Medicion.md) | El OCR de un escaneo cambia con la plataforma |
| OCR | [`T5_OSD_Compartido_Resultados.md`](./ocr/T5_OSD_Compartido_Resultados.md) | T-5, OSD compartido: implementación y medición |
| OCR | [`T5_OSD_Compartido_Resultados_Adelanto.md`](./ocr/T5_OSD_Compartido_Resultados_Adelanto.md) | T-5 con una página de adelanto |
| OCR | [`T5_OSD_Compartido_Resultados_Separados.md`](./ocr/T5_OSD_Compartido_Resultados_Separados.md) | T-5, resultados separados A/B/C |
| OCR | [`ImageData_Perfilado_Resultados.md`](./ocr/ImageData_Perfilado_Resultados.md) | `ImageData` en el worker de OCR |
| OCR | [`Margenes_Menos_Pixeles_Resultados.md`](./ocr/Margenes_Menos_Pixeles_Resultados.md) | Márgenes: tinta residual y su caja (M-1, M-2, M-1b) |
| OCR | [`Margenes_Menos_Pixeles_Medicion_I1.md`](./ocr/Margenes_Menos_Pixeles_Medicion_I1.md) | Márgenes I-1: A/B real |
| OCR | [`Margenes_Menos_Pixeles_Medicion_I2.md`](./ocr/Margenes_Menos_Pixeles_Medicion_I2.md) | Márgenes I-2: recorte vertical de franjas |
| NER | [`Hilos_NER_Medicion.md`](./ner/Hilos_NER_Medicion.md) | Hilos de ONNX, macOS y Windows nativo |
| NER | [`Empaquetado_NER_Medicion.md`](./ner/Empaquetado_NER_Medicion.md) | Empaquetado del modelo |
| NER | [`Perfilado_NER_Interno_Medicion.md`](./ner/Perfilado_NER_Interno_Medicion.md) | Perfilado interno A1/B/A2 |
| NER | [`Precalentamiento_NER_Durante_OCR_Medicion.md`](./ner/Precalentamiento_NER_Durante_OCR_Medicion.md) | Precarga del modelo durante el OCR |
| NER | [`Verificacion_Liberacion_NER_Medicion.md`](./ner/Verificacion_Liberacion_NER_Medicion.md) | Verificación de ADR-166 |
| NER | [`AB_Intercalado_Medicion.md`](./ner/AB_Intercalado_Medicion.md) | T-8: A/B intercalado sobre la baja del modelo |
| Regex | [`Patron_Email_Regex_Medicion.md`](./regex/Patron_Email_Regex_Medicion.md) | Patrón de email, macOS y Windows |
| Grouping | [`Agrupacion_Difusa_Medicion.md`](./grouping/Agrupacion_Difusa_Medicion.md) | Búsqueda difusa, macOS y Windows |
| Transversal | [`Atribucion_Recursos_Renderer_Medicion.md`](./transversal/Atribucion_Recursos_Renderer_Medicion.md) | Recursos del renderer |
| Transversal | [`Perfilado_Base_Caliente_Medicion.md`](./transversal/Perfilado_Base_Caliente_Medicion.md) | T-7: de qué está hecha la base caliente |
| Transversal | [`Ciclos_Y_Documentos_Reales_Medicion.md`](./transversal/Ciclos_Y_Documentos_Reales_Medicion.md) | T-9 a T-13: fuga, documentos reales, WASM, configuración de NER, tiempos |
| Transversal | [`PDFs_Pesados_Y_Exportacion_Medicion.md`](./transversal/PDFs_Pesados_Y_Exportacion_Medicion.md) | PDFs pesados hasta el archivo exportado |
| Transversal | [`Perfilado_Tiempo_Fuera_OCR_Medicion_M0_M1.md`](./transversal/Perfilado_Tiempo_Fuera_OCR_Medicion_M0_M1.md) | Tiempo fuera del OCR, M-0 a M-3 |
| Transversal | [`Banco_Windows_Comparativa_Medicion.md`](./transversal/Banco_Windows_Comparativa_Medicion.md) | El hardening contra la 0.9.2, y Windows contra el M1 |
