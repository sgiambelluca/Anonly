<!-- CONTEXT: scope=adr | dependencias=core/Export_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,architecture/04_Event_System.md,adr/ADR-009-Export-Strategy.md,adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md | audiencia=humanos+IA | fase=8 -->

# ADR-032 — Export Engine: `EncodedPageImage` en el provider, `EXPORT_REQUESTED` al Orchestrator y semántica de `EXPORT_NO_ENABLED_GROUPS`

- **Estado**: Accepted
- **Fecha**: 2026-07-16
- **Decidido por**: El humano, sobre auditoría preventiva del planificador previa al Hito 8 (práctica adoptada tras las dos detenciones del Hito 7)
- **Relacionado con**: ADR-004/ADR-009 (export por rasterización), ADR-014 (el Orchestrator invoca motores directamente para datos pesados), ADR-021 (inline hasta Hito 9), ADR-030 §1/§3 (precedentes de caller directo y warn+no-op), ADR-031 (erratas de spec pre-implementación)

## Contexto

Auditoría de `Export_Engine.md` v1.0.0 contra Contracts.md, `enums.ts`, 03/04/05/06 y ADR-009,
antes de lanzar la implementación. Verificado sin problemas: los 6 error codes de §11 existen en
`EngineErrorCode`, los 5 eventos `EXPORT_*` existen con payloads en Contracts.md §8,
`ExportConfig` es canónico (ADR-027), `shared/synthesizer.ts` existe, `Document.pageCount` y
`Page.width/height` existen, el gate `no-recuperability` está en 07 §11.4 y `test:security` ya
corre `--dir tests/security`. Tres hallazgos sí requieren decisión, más erratas.

## Decisión

### 1. `RenderPageProvider.renderFull` devuelve `EncodedPageImage`, no `ImageData`

```ts
export interface EncodedPageImage {
  readonly bytes: ArrayBuffer;     // imagen codificada (PNG o JPEG), lista para embedPng/embedJpg
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RenderPageProvider {
  renderFull(
    pageIndex: number,
    replacements: ReadonlyArray<Replacement>,
    abortSignal: AbortSignal,
  ): Promise<EncodedPageImage>;
}
```

- **Por qué**: pdf-lib solo embebe bytes codificados (`embedJpg`/`embedPng`, exigidos por el
  checklist §15.10); `ImageData` es RGBA crudo y codificarlo requiere canvas — dominio de
  Render/host, no del ensamblador. El resto de la arquitectura ya asume bytes codificados:
  `ExportPagePayload.pageImage: ArrayBuffer` (`shared/types.ts`, 05 §7.5) y 06 §13.
- El provider lo construye el **Orchestrator preconfigurado con las `ExportOptions`** del request
  (dpi/formato/calidad); Export solo pasa `pageIndex`/`replacements`/`abortSignal`. Las
  dimensiones de página en puntos salen de `document.pages[i].width/height`.
- Ambos tipos viven en `types.ts` del paquete `export-engine` (quien define el contrato del
  provider es quien lo consume; el Orchestrator, que importa motores, lo implementa).
- **Nota multi-formato**: `EncodedPageImage` es neutral al formato del documento de origen y de
  destino — es el punto de corte para exporters futuros (PNG suelto, TIFF, etc.). El export con
  texto seleccionable sigue vedado por ADR-004/ADR-009 (v2.0, ADR propio).

### 2. `EXPORT_REQUESTED` lo escucha el Orchestrator, no Export

El payload `{ documentId, options }` no alcanza para armar `ExportEngineInput` (faltan
`document`, `groups`, `rules` y el provider). Mismo caso que `DOCUMENT_IMPORTED` → ADR-014:

- 04 §10: receptor de `EXPORT_REQUESTED` pasa de "Export Engine" a **Orchestrator**, que arma
  `ExportEngineInput` y llama `ExportEngine.export()` directamente.
- Export **no se suscribe a ningún evento** (§8 del spec queda vacío); checklist §15.5 pierde la
  suscripción. En Hito 8 (inline) el caller directo son los tests/el façade (ADR-030 §1).

### 3. Semántica de `EXPORT_NO_ENABLED_GROUPS`: `logger.warn` + continuar

No existe (ni se crea) un evento `EXPORT_NO_ENABLED_GROUPS`, y "el usuario decide si continuar"
es un flujo de confirmación que el motor no puede ejecutar:

- `export()` con 0 grupos `enabled` **no lanza ni aborta**: emite `ctx.logger.warn` con el code
  en metadata y continúa (export = original reconstruido, caso legítimo).
- La confirmación del usuario es **pre-export** (Orchestrator/UI, Hito 9/10); la clase
  `ExportNoEnabledGroupsError` es el tipo de esa validación previa, no algo que `export()` lance.
- El test edge valida `logger.warn` + continuación.

### 4. Erratas

- `ExportOptions`/`ExportMetadata` se documentan formalmente en `03_Data_Model.md` §19 (forma
  exacta del código/ADR-009). Contracts.md §8 y ADR-009 ya apuntaban ahí, pero los tipos **no
  estaban** (P-10 exige tipos publicados documentados en Contracts.md o el spec).
- Export spec §4: se elimina `RENDER_FINISHED` de las dependencias (§8 aclara que no se consume).
- Export spec §14: `security.test.ts` vive en `tests/security/` (el script `test:security` corre
  `--dir tests/security`); `stress.test.ts` en `src/__tests__/` hasta que exista `tests/stress/`
  (mismo criterio que ADR-031 §5).
- Export spec §7 (nota `blobUrl`): "el motor emite el evento con `blobUrl` ya poblado por el
  Orchestrator" era temporalmente imposible. Inline (Hito 8) el motor crea el `blobUrl` él mismo
  con `URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }))` — blob **real**, a
  diferencia del placeholder de Render (ADR-031 §5). En Hito 9 lo arma el host; la revocación es
  responsabilidad del host (mismo criterio que el pendiente de Render en MVP.md §4).
- 06 §13: "Entra: `RenderPage[]`" (tipo inexistente) → `EncodedPageImage[]`.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Export codifica `ImageData` con su propio canvas | Duplica la responsabilidad de codificación de Render (§2 de su spec), agrega canvas al ensamblador y contradice 05 §7.5 (`pageImage: ArrayBuffer` ya codificado). |
| Crear el evento `EXPORT_NO_ENABLED_GROUPS` | Superficie de contrato nueva para un flujo que es pre-export del lado Orchestrator/UI; el motor no participa de la confirmación. |
| Export sigue suscripto a `EXPORT_REQUESTED` recordando estado previo | No hay estado que recordar: cada export es one-shot con input completo (a diferencia del delta render de ADR-030 §3). Precedente ADR-014. |
| `EncodedPageImage` en `@anonly/shared` | Solo lo usan Export (consume) y Orchestrator (implementa, y ya importa motores); en shared sería superficie global para un contrato local. Se puede promover si un segundo consumidor aparece. |

## Consecuencias

**Positivas**: el implementador del Hito 8 no tiene decisiones abiertas; la frontera
imagen-codificada queda en el lugar correcto para exporters multi-formato futuros; la asimetría
con ADR-014 (eventos livianos, invocación directa con datos pesados) queda cerrada para el último
motor; P-10 vuelve a ser verdadero para `ExportOptions`/`ExportMetadata`.

**Negativas**: el Orchestrator (Hito 9) suma responsabilidades explícitas: escuchar
`EXPORT_REQUESTED`, armar el input, preconfigurar el provider con las options, codificar las
páginas full (canvas del host) y correr la validación pre-export de grupos habilitados.

## Referencias

- `core/Export_Engine.md` §1, §2, §4, §6–§8, §11, §13–§15 — `architecture/03_Data_Model.md` §19
- `architecture/04_Event_System.md` §10 — `architecture/06_Pipeline.md` §13
- `packages/anonymization-core/shared/src/types.ts` (`ExportPagePayload`, `ExportOptions`, `ExportMetadata`)
- `adr/ADR-009-Export-Strategy.md` — `adr/ADR-014-OCR-PDF-Fusion-Orchestrator.md` — `adr/ADR-030` §1/§3 — `adr/ADR-031` §5
