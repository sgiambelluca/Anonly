<!-- CONTEXT: scope=roadmap-v2 | dependencias=roadmap/Version_1.0.md,roadmap/Roadmap_1.x.md,roadmap/Future_Ideas.md,01_Technical_Architecture_Document.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md | audiencia=humanos+IA | fase=12 -->

# Anonly — Roadmap v2.0

> **Reescrito el 2026-10-02**, con las decisiones del humano de ese día. La
> versión anterior definía la 2.0 como «más formatos y más plataformas».
> Los formatos pasaron a la 1.3 y el escritorio ya es la 1.0, así que la 2.0
> queda para los cambios que rompen algo o que cambian el motor de detección.

**Versión objetivo**: 2.0.0. Sin fecha.

Como en `Roadmap_1.x.md`, cada ítem arranca con la auditoría del
planificador, su ADR y sus specs antes del código.

## 1. En la 2.0

### 1.1 Migración de Electron a Tauri

Intención registrada el 2026-09-14 (`Future_Ideas.md` §2.5, que conserva el
análisis). Busca un contenedor más liviano.

**Para decidir al llegar**

- Electron fija la versión de Chromium; Tauri usa el webview del sistema, y
  entonces la versión del motor la decide el sistema operativo. El producto
  depende de `OffscreenCanvas`, Web Workers, WASM SIMD y del aislamiento de
  origen cruzado (ADR-100, ADR-130), y ADR-053 ya mostró lo sensible que es
  el render al motor.
- La ganancia de tamaño se diluye contra los ~200 MB de modelos que viajan
  igual.
- El actualizador, la firma de actualizaciones (ADR-131, ADR-137) y el modelo
  de seguridad del contenedor (`08_Security_Model.md`) se rehacen.
- Es versión mayor porque cambia el contenedor y puede cambiar los sistemas
  soportados.

### 1.2 NER entrenado para Argentina

Un modelo ajustado para nombres y apellidos argentinos, direcciones con
formato local, matrículas por jurisdicción y jerga legal o médica
(`Future_Ideas.md` §1.1). Se carga por `NerConfig.modelId`.

### 1.3 Detección con un LLM local

Un modelo de lenguaje chico, corriendo en la computadora. No reemplaza lo que
hace el NER: el NER etiqueta palabras; un LLM puede además usar el contexto,
por ejemplo para saber que «el doctor» se refiere a una persona ya nombrada
(`Future_Ideas.md` §1.2). Cuesta entre 2 y 4 GB de descarga y de memoria.

## 2. Sin definir

El humano no les asignó versión. No se planifican hasta que lo haga.

- **Móvil** (React Native).
- **Extensión de navegador.**
- **Sistema de plugins** y publicación del Core como librería.

## 3. Lo que estaba en la 2.0 y cambió de lugar

| Ítem | Dónde quedó |
|---|---|
| Aplicación de escritorio | es la 1.0 (ADR-130) |
| Entrada de Word, imágenes sueltas, Excel y PowerPoint; export a Word | 1.3 (`Roadmap_1.x.md` §6) |
| Cola de varios documentos | 1.2 (`Roadmap_1.x.md` §5) |
| Export con texto preservado y PDF/A | 1.3 (`Roadmap_1.x.md` §6) |
| Plantillas de reglas | idea sin versión (`Future_Ideas.md` §4.2) |
| Agrupación por embeddings, comparación de documentos, OCR con WASM multihilo, PDF de más de 1000 páginas, caché de grupos | ideas sin fecha (`Future_Ideas.md`) |

## 4. Referencias

- `roadmap/Roadmap_1.x.md`
- `roadmap/Future_Ideas.md`
- `01_Technical_Architecture_Document.md` §2 (los principios se respetan)
