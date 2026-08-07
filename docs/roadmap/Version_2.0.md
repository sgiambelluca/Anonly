<!-- CONTEXT: scope=roadmap-v2 | dependencias=roadmap/Version_1.0.md,01_Technical_Architecture_Document.md | audiencia=humanos+IA | fase=5 -->

# Anonly — Roadmap v2.0

> Expansión del producto a más formatos, más plataformas, más casos de uso. v2.0 **sí** puede requerir extensiones arquitecturales (nuevos engines, nuevos pools), pero siempre respetando los principios del TAD.

**Versión objetivo**: 2.0.0
**Criterio**: features listadas + sin regresión en métricas v1.0.

---

## 1. Objetivo v2.0

Convertir Anonly de "anonimizador de PDF web" a "plataforma de anonimización documental multi-formato y multi-plataforma", manteniendo el principio local-first y el Core desacoplado.

---

## 2. Features v2.0

### 2.1 Formatos de entrada

- **Word (.docx)**: nuevo `word-engine` que parsea .docx (probablemente con `docx.js` o `mammoth`) y produce el mismo `DocumentModel` que `pdf-engine`. El pipeline es idéntico desde la etapa 3 en adelante.
- **Imágenes (PNG, JPEG, TIFF)**: nuevo `image-engine` que toma una imagen, rasteriza (ya es imagen), ejecuta OCR directo y produce `DocumentModel`.
- **Excel (.xlsx)**: nuevo `excel-engine` que parsea celdas y aplica Regex + NER a cada celda. UI adaptada para mostrar grilla en lugar de páginas.
- **PowerPoint (.pptx)**: parseo + render por slide.

### 2.2 Plataformas

- **App de escritorio empaquetada**: instalador que el usuario baja una vez, instala, y usa **sin conexión** desde ese momento — con la ventaja de que, si hay red, puede actualizarse solo. Reutiliza todo el Core sin cambios (es 100% browser-compatible). Es el destino final de la promesa "100% local"; el escalón previo es la PWA instalable de `Version_1.0.md` §2.7.

  Cuatro cosas que este empaquetado cambia respecto de la web y que **no** son detalles de packaging:

  1. **El actualizador es la primera salida de red legítima del producto.** El gate `no-network-from-core` (`08_Security_Model.md` §11) sigue verde —el updater vive en el shell, no en `packages/`— pero la aplicación pasa a hacer requests salientes, y eso hay que enunciarlo con precisión antes de que se lea como contradicción del pitch: *el Core nunca habla con la red; el contenedor puede, exclusivamente para consultar versiones y bajar actualizaciones firmadas, y nunca con contenido de un documento*. Requiere ADR propio, con firma de releases y política de qué se envía en el chequeo (idealmente: nada más que la versión actual).
  2. **Se invierte la estrategia de assets de ADR-018.** Hoy los ~219 MB de modelo NER y wasm de Tesseract se descargan a demanda y se cachean; en un instalador viajan **dentro del paquete** y no se descarga nada después. Mejor producto, y vuelve irrelevante buena parte del razonamiento de bundle-size del cliente web (incluido el del léxico de nombres de ADR-060 §10). El `assets.lock.json` pasa de ser un manifiesto de mirroring a ser parte del build del instalador.
  3. **El modelo de seguridad hay que reescribirlo, no adaptarlo.** `08_Security_Model.md` §3.2 está escrito para un origen web con CSP. Un contenedor de escritorio tiene otra postura —aislamiento de contexto, acceso a filesystem, origen `file://` o local— y el `no-third-party-connect` de E2E asume un browser. Es un ADR, no una nota al pie.
  4. **Electron vs Tauri no es obvio, y este proyecto tiene un motivo fuerte para Electron.** Tauri produce instaladores mucho más chicos porque usa el webview del sistema, pero entonces la versión del motor la decide el SO. Anonly depende fuerte de `OffscreenCanvas`, Web Workers y WASM SIMD, y ADR-053 ya mostró lo sensible que es el render a los detalles del motor de renderizado. Electron fija qué Chromium corre; Tauri no. La ganancia de tamaño de Tauri además se diluye contra los 219 MB de modelos que hay que empaquetar igual.
- **React Native (móvil)**: nuevo cliente `apps/mobile-client` que consume el Core. Requiere que el Core sea compatible con React Native (sin DOM, sin Web Workers → usar Worker threads nativos o JSC). Posible ADR de adaptación.
- **Extensiones de navegador**: packaging del cliente web como extensión Chrome/Firefox. Procesa PDFs abiertos en el navegador.

### 2.3 Pipeline avanzado

- **Agrupación semántica con embeddings**: opción en `GroupingEngine` para usar embeddings (sentence-transformers) en lugar de Levenshtein. Mejor recall en aliases ("Dr. Juan Pérez" vs "Juan Pérez García"). ADR específico.
- **NER entrenado para Argentina / jerga legal / jerga médica**: cargar modelos específicos con `NerConfig.modelId`. Ver `roadmap/Future_Ideas.md`.
- **Reprocesamiento automático tras edición**: si el usuario edita `canonicalValue`, re-buscar ocurrencias similares en todo el documento y sugerir agregarlas al grupo.

### 2.4 Export

- **Modo "texto preservado"**: opción de export que preserva texto no sensible como capa seleccionable, con verificación criptográfica de que las regiones sensibles están eliminadas (no tapadas). Requiere su propio ADR (Preserved Text Export).
- **PDF/A-2b o PDF/A-3b**: para uso legal/archivo. Requiere pdf-lib con soporte o lib externa.
- **Export a Word**: para usuarios que editaron el original y quieren el resultado editable.
- **Export multi-formato simultáneo** (PDF + imágenes + Word).

### 2.5 UI

- **Visor Word/Excel**: con highlighting adaptado a la estructura del formato.
- **Batch de documentos**: UI para encolar y procesar varios documentos, con cola visible y estimación de tiempo.
- **Plantillas de reglas**: guardar sets de reglas como plantillas reutilizables entre documentos.
- **Comparación de documentos**: cargar dos documentos y comparar las entidades detectadas.

### 2.6 Plugins / extensibilidad

- **Sistema de plugins**: API para que terceros agreguen engines custom (ej. detector de IBAN de un país específico, detector de matrículas médicas). Requiere su propio ADR (Plugin System).
- **API pública del Core**: publicar `@anonly/anonymization-core` como lib npm consumible por terceros.

### 2.7 Performance

- **SharedArrayBuffer + WASM threads** para NER y OCR (si COOP/COEP ampliamente adoptable).
- **Streaming de PDFs enormes** (> 1000 páginas) sin OOM, descartando páginas procesadas.
- **Cache de grupos en IndexedDB** (solo metadatos no sensibles) para reabrir documentos recientes.

---

## 3. ADRs nuevos esperados en v2.0

> Sin número reservado: la numeración se asigna al crear cada ADR, tomando el siguiente número libre en `docs/adr/` (ver nota en `Version_1.0.md` §4).

- Preserved Text Export
- Plugin System
- Word Engine
- Image Engine
- Excel Engine
- Desktop Packaging (Electron vs Tauri, actualizador firmado, assets en el instalador, modelo de seguridad del contenedor — §2.2)
- React Native Adaptation
- Semantic Grouping
- PDF/A Export
- Batch Processing

---

## 4. Métricas v2.0

Mantienen las v1.0 con adiciones:

| Métrica | Target v2.0 |
|---|---|
| Soporte formatos | PDF, Word, Excel, PowerPoint, PNG, JPEG, TIFF |
| Plataformas | Web, escritorio empaquetado (Win/Mac/Linux), React Native (iOS/Android), extensiones |
| Batch | hasta 50 documentos encolados sin OOM |
| Plugin API | pública y estable |

---

## 5. Hitos v2.0 (alto nivel)

1. Word engine.
2. Image engine.
3. Modo texto preservado (con research previo).
4. Desktop packaging (instalador + actualizador; ADRs previos: contenedor y actualizador, §2.2).
5. React Native adaptation.
6. Batch UI.
7. Plugin system.
8. PDF/A export.
9. Semantic grouping opcional.
10. v2.0 release.

---

## 6. Referencias

- `roadmap/Version_1.0.md`
- `roadmap/Future_Ideas.md`
- `01_Technical_Architecture_Document.md` §2 (principios deben respetarse)
- `ADR-002-No-Backend.md` (Electron sigue siendo local-first)
