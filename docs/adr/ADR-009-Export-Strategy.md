<!-- CONTEXT: scope=adr | dependencias=08_Security_Model.md,06_Pipeline.md,ADR-004-Rendering.md | audiencia=humanos+IA | fase=2 -->

# ADR-009 — Estrategia de Exportación

- **Estado**: Accepted
- **Fecha**: 2026-06-17
- **Decidido por**: Planificación inicial
- **Relacionado con**: ADR-004-Rendering

## Contexto

Definir cómo el `Export Engine` produce el PDF final. ADR-004 decidió reconstrucción (no redacción in-place); este ADR define los detalles operativos: formato de imagen, DPI, metadata, opciones al usuario, y garantías.

## Decisión

### Pipeline de export

1. El usuario dispara `EXPORT_REQUESTED` con `ExportOptions`.
2. Export Engine valida que haya al menos un grupo `enabled` (warning si no).
3. Para cada página:
   a. Render Engine produce una imagen (PNG o JPEG según opción) con los reemplazos aplicados.
   b. Export Engine adjunta la imagen como página de un `PDFDocument` (pdf-lib) nuevo.
4. Export Engine serializa el `PDFDocument` a `ArrayBuffer` (transferido de vuelta al host).
5. Host crea `blobUrl` y dispara descarga o preview.

### Opciones al usuario (`ExportOptions`)

```ts
export interface ExportOptions {
  readonly imageFormat: "png" | "jpeg";
  readonly jpegQuality: number;       // 0..1, default 0.85
  readonly dpi: number;               // default 150; 300 para "alta calidad"
  readonly includeOriginalMetadata: false;  // SIEMPRE false; el tipo lo fuerza
  readonly title?: string;            // opcional, metadata nueva
  readonly filename: string;          // default "anonimizado.pdf"
}
```

- `includeOriginalMetadata` es **literalmente `false`** por tipo: no se puede activar. Garantía de seguridad por tipos, no por disciplina.

### Metadata del export

```ts
export interface ExportMetadata {
  readonly producer: "Anonly";
  readonly creator: "Anonly";
  readonly creationDate: Date;
  readonly title?: string;
}
```

Sin `author`, sin `subject`, sin `keywords`, sin XMP del original.

### DPI y tamaño

- Default 150 DPI: balance tamaño/legibilidad.
- 300 DPI: para "alta calidad" (documentos legales).
- El tamaño del PDF escala cuadráticamente con DPI; 300 = ~4x tamaño de 150.

### Garantías

1. **No-recuperabilidad**: el texto del PDF original no está en el export. Validado por `no-recuperability` test.
2. **Sin metadata sensible**: validado por `metadata-strip` test.
3. **Sin JavaScript embebido**: el nuevo PDF no tiene JS.
4. **Sin forms**: el nuevo PDF no tiene AcroForm.
5. **Sin bookmarks**: el nuevo PDF no tiene bookmarks del original.
6. **Sin links**: el nuevo PDF no tiene links del original (pueden ser sensibles: URLs internas).

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Export solo PNG (sin PDF)** | Útil pero no es el producto prometido. Puede ser un modo extra ("Exportar imágenes") en v1.0. |
| **Export con texto seleccionable** | Requiere re-construir capas de texto verificadamente seguras. Riesgo de fuga. MVP no lo incluye. |
| **Export PDF/A para archivo** | Buena idea para legal, pero pdf-lib no lo soporta nativamente. Futuro. |
| **Export con marca de agua "Anonimizado por Anonly"** | Útil para marketing pero puede ser no deseado por el usuario. Se puede hacer opcional en v1.0. Default off. |
| **Multi-formato (PDF + Word + imagen)** | Out of scope MVP. Word es v2.0. |

## Consecuencias

**Positivas**:
- Garantía de seguridad simple de testear.
- Tamaño controlable por el usuario (DPI/calidad).
- Pipeline de export claro y lineal.

**Negativas**:
- El export no es seleccionable ni buscable (es "scanned-like"). Trade-off aceptado por seguridad.
- Tamaño del archivo mayor que un PDF texto.
- Sin bookmarks/links útiles del original.

**Neutras**:
- Modo "texto preservado seguro" es candidato a v2.0 con investigación adicional y su propio ADR.

## Referencias

- `08_Security_Model.md` §4, §5
- `06_Pipeline.md` §13 (etapa 11)
- `ADR-004-Rendering.md`
- `core/Export_Engine.md` (spec)
- `03_Data_Model.md` (tipos `ExportOptions`, `ExportMetadata`)
