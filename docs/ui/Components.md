<!-- CONTEXT: scope=componentes-ui | dependencias=ui/React_Client.md,ui/UX_Guidelines.md,ADR-001-Framework.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md | audiencia=IA-implementador-ui | fase=4 (reconciliado en fase 10 por ADR-036: PasswordDialog/SettingsDialog/ConfirmDialog agregados §2.6–2.7/§8.9, zoom §5.2, mapeo §12; §2.6/§5.2/§5.5/§12 reescritos por ADR-037 —zoom con re-render real— y ADR-038 —SettingsDialog dispara reanalyze, no recreación del core—; §2.1/§2.5/§13.9 ajustados 2026-07-22 por el bug #7 del Escenario 1 E2E: gate de visibilidad por stage vs. vida del diálogo hijo abierto; §5.2/§5.4 en fase 11 por ADR-056 —requestRender con kind por panel, canvas que no se borra—) -->

# Anonly — Catálogo de Componentes

> Catálogo de componentes de UI (Radix UI + Tailwind). Cada componente declara: props, estados, eventos que dispara (via `actions`), stores que consume, y mapeo al Core. Los componentes son **presentacionales** + **connectores**; la lógica vive en `core-adapter` y `store`.

**Stack**: React + Tailwind CSS + Radix UI (primitives accesibles) + Zustand.

---

## 1. Estructura

```
apps/react-client/src/components/
├── toolbar/
│   ├── Toolbar.tsx
│   ├── ImportButton.tsx
│   ├── PipelineStatus.tsx
│   ├── CancelButton.tsx
│   ├── ExportButton.tsx
│   ├── SettingsButton.tsx    // ADR-036 §7
│   ├── SettingsDialog.tsx    // ADR-036 §7
│   ├── PasswordDialog.tsx    // ADR-036 §7
│   └── CloseDocumentButton.tsx  // ADR-051
├── entities/
│   ├── EntitiesPanel.tsx
│   ├── EntityTypeGroup.tsx
│   ├── EntityGroupItem.tsx
│   ├── ReplacementModeSelect.tsx
│   ├── GroupContextMenu.tsx
│   ├── MergeDialog.tsx
│   └── SplitDialog.tsx
├── rules/
│   ├── RulesPanel.tsx
│   ├── RuleItem.tsx
│   ├── RuleCreatorDialog.tsx
│   └── RuleEditorDialog.tsx
├── viewer/
│   ├── PdfViewer.tsx
│   ├── PageVirtualizer.tsx
│   ├── PageCanvas.tsx
│   ├── SideBySideViewer.tsx
│   ├── ZoomControls.tsx
│   └── ScrollSyncToggle.tsx   # ADR-054 §2
├── conflicts/
│   ├── ConflictBadge.tsx
│   └── ConflictDialog.tsx
├── export/
│   ├── ExportDialog.tsx
│   └── ExportProgress.tsx
├── common/
│   ├── Button.tsx
│   ├── Dialog.tsx           // wrapper sobre Radix Dialog
│   ├── ConfirmDialog.tsx    // confirmación genérica (ADR-036 §7)
│   ├── Select.tsx           // wrapper sobre Radix Select
│   ├── Checkbox.tsx
│   ├── Tooltip.tsx
│   ├── Toast.tsx
│   ├── Banner.tsx
│   └── Skeleton.tsx
└── App.tsx
```

---

## 2. Componentes del Toolbar

### 2.1 `Toolbar`

- **Props**: ninguno (lee `pipeline.store`).
- **Stores**: `pipeline`, `document`, `settings`.
- **Estados**:
  - `stage === Idle`: solo botón "Importar PDF".
  - `stage ∈ {Importing, Extracting, OCRing, Detecting, Grouping}`: `PipelineStatus` + `CancelButton`.
  - `stage ∈ {Ready, Done}`: `PipelineStatus` + `ExportButton` + `CloseDocumentButton` (+ `CancelButton` si hay jobs remanentes). (`Done` no tenía fila — gap cerrado al resolver el bug #7 del Escenario 1 E2E: tras un export el documento sigue abierto y re-exportable. `CloseDocumentButton` agregado por ADR-051.)
  - `stage === Rendering/Exporting`: `PipelineStatus` + `CancelButton`.
  - `stage === Failed`: banner de error + "Reintentar" o "Cerrar" (el "Cerrar" del banner, sin confirmación) + `CloseDocumentButton`.
  - `stage === Cancelled`: `PipelineStatus` + `CloseDocumentButton`.
- **Acciones**: ninguna directa; delega en hijos.

### 2.2 `ImportButton`

- **Comportamiento**: `<input type="file" accept="application/pdf">` oculto + label estilizado. Drag&drop en todo el App.
- **Acción**: `actions.importDocument(file)`.
- **Atajo**: `Cmd/Ctrl+O`.

### 2.3 `PipelineStatus`

- **Estados**: muestra icono + texto según `stage` (ver `UX_Guidelines.md` §7.1).
- **Props**: ninguno (lee `pipeline.store`).
- **Sub-estados**:
  - `modelLoading != null`: "Cargando modelo NER… 45%".
  - `exportProgress != null`: "Exportando página 7 de 10…".
  - En otros casos: texto descriptivo + barra de progreso.

### 2.4 `CancelButton`

- **Visible**: cuando `stage ∉ {Idle, Done, Failed, Cancelled}`.
- **Acción**: abre `ConfirmDialog` → `actions.cancel()`.
- **Atajo**: `Cmd/Ctrl+.`.

### 2.5 `ExportButton`

- **Visible**: cuando `stage ∈ {Ready, Done}` (`Done` permite reabrir el diálogo con el resultado — "Descargar"/"Exportar otro", §7.2).
- **Vida del diálogo (bug #7 del Escenario 1 E2E, 2026-07-22)**: el gate de visibilidad aplica **solo al botón**; mientras `ExportDialog` esté abierto, el componente permanece montado aunque `stage` salga del set (`Exporting` durante el export, `Done` al finalizar) — `if (!visible && !open) return null`, nunca `if (!visible) return null` a secas. Sin esto, la transición `Ready → Exporting → Done` que el Core hace por spec (`Orchestrator.md` §8) desmonta el diálogo abierto con todo su estado justo antes de pintar el link de descarga.
- **Acción**: abre `ExportDialog`.
- **Atajo**: `Cmd/Ctrl+E` (activo solo cuando el botón es visible).

### 2.6 `SettingsButton` + `SettingsDialog` (ADR-036 §7)

- **Trigger**: icono de engranaje en el Toolbar (siempre visible; `UX_Guidelines.md` §2).
- **Stores**: `settings`, `document` (para saber si hay documento abierto).
- **Form** (`MVP.md` §2.3): idioma (`es` default), performance preset (`auto`/`low`/`high`), NER toggle, OCR languages.
- **Acción**: muta `settings.store` + `settings.persist()`. Si el cambio es `nerEnabled`/`ocrLanguages` y hay documento abierto: `ConfirmDialog` "¿Reanalizar el documento con la nueva configuración? Tus ediciones se conservan." → `actions.reanalyze(patch)` (ADR-038 §7, `React_Client.md` §3.7 — **no** recrea el core). Si es `performancePreset` con documento abierto: se persiste y aplica al próximo documento, sin diálogo de confirmación (ADR-038 §7 Q3).
- **ARIA**: `aria-label="Configuración"`.

### 2.7 `PasswordDialog` (ADR-036 §7)

- **Se abre por**: `PDF_PASSWORD_REQUIRED` (suscripción **directa** de la UI al canal `pdf` — ADR-034 §4; el stage queda en `Extracting`).
- **Acción**: submit → `actions.retryWithPassword(password)` (`orchestrator.retryWithPassword`; **nunca** `engines.pdf.process` — Orchestrator.md §6). Si el evento vuelve a llegar, muestra "Contraseña incorrecta" y re-pide.
- **Cancelar**: cierra el diálogo y ofrece cerrar el documento (`actions.closeDocument`).
- **Seguridad**: el input **nunca** se loguea ni persiste (`08_Security_Model.md` §7); `type="password"`, sin autocompletado.

### 2.8 `CloseDocumentButton` (ADR-051)

- **Visible**: hay documento activo y `stage ∈ {Ready, Done, Failed, Cancelled}` — o sea, con el pipeline detenido. Durante una corrida el control es `CancelButton` (§2.4), no este: cerrar a mitad de pipeline es "cancelar + liberar" (`Orchestrator.md` §13 caso 11) y dos botones para lo mismo solo multiplican caminos.
- **Acción**: abre `ConfirmDialog` ("¿Cerrar el documento? Se perderán las ediciones y reglas de esta sesión.") → `actions.closeDocument()`.
- **Vida del diálogo**: aplica la regla 9 de §13 (`if (!visible && !open) return null`) — un `PIPELINE_STAGE_CHANGED` por debajo no puede desmontar el `ConfirmDialog` abierto.
- **Atajo**: ninguno en MVP (`Cmd/Ctrl+W` lo captura el navegador).
- **ARIA**: `aria-label="Cerrar documento"`.
- **Por qué existe** (ADR-051): sin este control, un documento que llega a `Ready` solo se puede cerrar recargando la pestaña, y como `validateImportInput` exige cerrar antes de importar otro (`Orchestrator.md` §13 caso 12), tampoco se podía abrir un segundo PDF. Bloqueaba además el Escenario 7 E2E y el gate `test:leak` de Hito 11.
- **No confundir con** el "Cerrar documento" del banner de error de `PipelineStatus` (§2.3): ese cierra **sin** confirmación, porque en `Failed` no hay ediciones que perder. Los dos conviven a propósito.

---

## 3. Componentes de Entidades

### 3.1 `EntitiesPanel`

- **Stores**: `entities`, `pipeline`.
- **Comportamiento**: lista `groupsByType` ordenada por `EntityType` (orden fijo: Person, Organization, Address, DNI, CUIT, Phone, Email, IBAN, CreditCard, Date, License, Plate, Custom).
- **Sub-componentes**: `EntityTypeGroup` por tipo.
- **Header**: "Entidades" + input de búsqueda + "Colapsar todo" / "Expandir todo".
- **Estado vacío**: ver `UX_Guidelines.md` §11.

### 3.2 `EntityTypeGroup`

- **Props**: `type: EntityType`, `groups: ReadonlyArray<EntityGroup>`.
- **Render**: cabecera expandible con checkbox cascade + lista de `EntityGroupItem`.
- **Eventos**:
  - Click cabecera → toggle expand.
  - Checkbox cabecera → `actions.updateGroup(g.id, { enabled: value })` para todos los grupos del tipo.
- **ARIA**: `role="treeitem"` con `aria-expanded`.

### 3.3 `EntityGroupItem`

- **Props**: `group: EntityGroup`.
- **Render**: checkbox + canonicalValue + badge ocurrencias + `ReplacementModeSelect` + `[⋯]` (`GroupContextMenu` trigger).
- **Estados**:
  - habilitado / deshabilitado.
  - con conflicto (icono ⚠).
  - editado manualmente (punto azul).
- **Eventos**:
  - Checkbox → `actions.updateGroup(group.id, { enabled: value })`.
  - Click canonicalValue → popover con aliases y "Editar valor canónico".
  - Click ⚠ → `ConflictDialog`.
- **ARIA**: `role="treeitem"`, `aria-checked`, `aria-label` con tipo + count + estado.

### 3.4 `ReplacementModeSelect`

- **Props**: `groupId`, `currentMode`.
- **Opciones**: `placeholder` (default), `mask`, `synthetic`, `redact`.
- **Acción**: `actions.updateGroup(groupId, { replacementMode: newMode })`.
- **Implementación**: Radix `Select` con iconos por modo y preview del valor resultante.

### 3.5 `GroupContextMenu`

- **Trigger**: botón `[⋯]` en `EntityGroupItem`.
- **Opciones**:
  - "Fusionar con…" → `MergeDialog`.
  - "Dividir…" → `SplitDialog`.
  - "Ver ocurrencias" → popover con lista `members` (pageIndex + bbox + value).
  - "Editar valor canónico" → input inline.
  - "Eliminar grupo" → `ConfirmDialog` → `actions.updateGroup(groupId, { enabled: false })` (no se elimina, se deshabilita; en MVP no se elimina completamente).

### 3.6 `MergeDialog`

- **Props**: `sourceGroupId`.
- **Comportamiento**: autocomplete para elegir `targetGroupId` (filtrado por mismo `EntityType`).
- **Acción**: `actions.mergeGroups(sourceGroupId, targetGroupId)`.
- **Feedback**: toast "Grupos fusionados. Índice conservado: 01."

### 3.7 `SplitDialog`

- **Props**: `groupId`.
- **Comportamiento**: lista de `members` con checkbox. Muestra bbox miniatura por ocurrencia.
- **Acción**: `actions.splitGroup(groupId, selectedOccurrenceIds)`.
- **Feedback**: toast "Grupo dividido. Nuevo grupo: <type> <NN>."

---

## 4. Componentes de Reglas

### 4.1 `RulesPanel`

- **Stores**: `rules`.
- **Render**: tres secciones (Global / Por tipo / Por grupo) + botón "+ Nueva regla".
- **Estado vacío**: placeholder "Aún no hay reglas…" (ver `UX_Guidelines.md` §11).

### 4.2 `RuleItem`

- **Props**: `rule: Rule`.
- **Render**: descripción legible ("DNI → mask", "Juan Pérez → redact") + botones `[✎]` `[🗑]`.
- **Acciones**:
  - `[✎]` → `RuleEditorDialog`.
  - `[🗑]` → `ConfirmDialog` → `actions.deleteRule(rule.id)` (vía `RULE_DELETED`).

### 4.3 `RuleCreatorDialog`

- **Comportamiento**: ver `UX_Guidelines.md` §4.1.
- **Acción**: `actions.createRule(rule)` → `RULE_CREATED`.

### 4.4 `RuleEditorDialog`

- **Props**: `ruleId`.
- **Acción**: `actions.updateRule(ruleId, patch)` → `RULE_UPDATED`.

---

## 5. Componentes del Visor

### 5.1 `SideBySideViewer`

- **Stores**: `viewer`, `document`, `settings` (para `scrollSyncEnabled`).
- **Render**: dos `PdfViewer` lado a lado (original + anonymized), con **scroll independiente por panel** (ADR-054 §1, reemplaza "con scroll sincronizado"). Cada uno monta su propio rango y pide sus propios renders; mover uno no mueve al otro.
- **Props**: ninguno (todo via store).
- **Mobile** (< 1024 px): tabs en lugar de lado a lado. **Sin cambios por ADR-054**: es requisito explícito conservar este modo tal cual.
- **Sincronización opcional** (ADR-054 §3/§4): con `settings.scrollSyncEnabled` en `true`, mover un panel arrastra al otro **a nivel de píxel** (`scrollTop` contra `scrollTop`; la geometría de los dos paneles es idéntica). Nunca por índice de página. La convergencia sale de la idempotencia —el seguidor, ya en el valor exacto, no propaga nada— así que **no** se implementa con bandera + temporizador. Casos límite, resueltos por comparación de valor: un panel que no puede alcanzar la posición (recorte del navegador) no propaga la suya; un panel oculto (alto cero, modo tabs) se saltea y se realinea al volverse visible.
- El control que prende esa sincronización **no vive acá**: está en la barra del visor, junto a `ZoomControls` (§5.6).

### 5.2 `PdfViewer`

- **Props**: `kind: "original" | "anonymized"`.
- **Stores**: `viewer`, `entities` (para highlights en `original`), `document`.
- **Comportamiento**: usa `PageVirtualizer` para renderizar solo visibles. Escucha `PREVIEW_UPDATED` via `viewer.previewByPage[kind]` (por panel, `React_Client.md` §3.5 — evita re-renderizar este `PdfViewer` cuando el preview que cambió es del otro panel) y pasa el `blobUrl` al `PageCanvas` correspondiente.
- **Eventos** (reconciliados por ADR-036 §5, reescrito por ADR-037, `kind` agregado por ADR-056 §1/§2):
  - Cambio de `visibleRange` → `actions.requestRender(pageIndices, kind)` — **con el `kind` de este panel**: el motor renderiza solo ese lado. Antes se emitía sin `kind` y Render producía original y anonimizado, lo que con scroll independiente (ADR-054) hacía que scrollear este panel refrescara el otro.
  - Cambio de `zoom` → escala **CSS/canvas** del bitmap ya renderizado de inmediato (feedback durante el gesto) y, tras 150 ms sin nuevos ticks, `actions.requestRender(visibleRange, kind, "preview", previewScale × zoom)` para un **re-render real** (ADR-037 §1/§5, supersede ADR-036 §6). El `PREVIEW_UPDATED` resultante reemplaza el bitmap CSS transitorio por el nítido.
  - Primer render al observar `Ready` (`readyRenderTrigger.ts`) → también con el `kind` de este panel.
  - **El `kind` sale siempre de la prop de este componente, nunca de `settings.scrollSyncEnabled`** (ADR-056 §2). Con la sincronización apagada el comportamiento lazy —solo se refresca el panel que se está moviendo— sale gratis de que cada panel hable por sí mismo; con ella prendida los dos paneles se mueven y los dos emiten. No hay condicional que escribir.

### 5.3 `PageVirtualizer`

- **Props**: `kind`, `pageCount`, `renderItem: (index) => ReactNode`, `visibleRange`, `pageSize`, `onVisibleRangeChange`, `onCurrentPageIndexChange`, `scrollSync`. **Sin `scrollToPageIndex`** (ADR-054 §6): esa prop y el efecto de sincronización que la consumía se retiran junto con `scrollSync.ts`/`computeScrollSyncTarget` — con scroll independiente no existe el concepto de seguidor, y con la sincronización prendida la mecánica es la de §5.1, que no pasa por props.
  - `kind`: identifica el panel para registrarse en `scrollSync` y para derivar/reportar su propia página actual.
  - `onVisibleRangeChange`: reporta al rango que detecta el `IntersectionObserver` (rango de **montaje** únicamente, ADR-054 §5) — cierra el loop de "usa `IntersectionObserver` para detectar visibilidad" hacia el estado controlado por `PdfViewer`.
  - `onCurrentPageIndexChange(pageIndex)`: página actual derivada por geometría de scroll (ADR-054 §5), reportada solo cuando cambia.
  - `scrollSync`: controller de sincronización opcional de scroll (ADR-054 §3), instanciado una sola vez por `SideBySideViewer` y compartido entre sus dos `PdfViewer`/`PageVirtualizer`.
- **Comportamiento**: mantiene un pool de `<canvas>` reutilizables. Calcula scroll height total con `pageCount × pageSize`. Solo renderiza items en `visibleRange` + 1 antes + 1 después.
- **Performance**: usa `IntersectionObserver` para detectar visibilidad y `requestAnimationFrame` para scroll suave.
- **Alcance del `IntersectionObserver` (ADR-054 §5)**: decide **únicamente el rango de montaje**. Reducir el conjunto de índices que reporta a `min..max` es correcto para eso —un conjunto transitoriamente no contiguo monta una página de más, que es inofensivo— pero **no** sirve para derivar la página actual: ahí un índice viejo colapsaba el rango a `start: 0`. La página actual se calcula de la geometría del scroll (`React_Client.md` §3.5).

### 5.4 `PageCanvas`

- **Props**: `pageIndex`, `kind`, `blobUrl?`, `annotations?`, `highlights?`.
- **Render**: `<canvas>` con dimensión correcta. Si `blobUrl`, dibuja la imagen. Si `annotations` (kind=original), dibuja bordes color por tipo. Si `highlights` con conflicto, dibuja borde rojo.
- **Skeleton**: si `!blobUrl`, dibuja skeleton gris con dimensión.
- **Las dimensiones del `<canvas>` solo se asignan cuando cambian (ADR-056 §5)**. Asignar `canvas.width`/`canvas.height` **borra el bitmap aunque el valor sea idéntico** — es comportamiento del estándar HTML, no del navegador. Como el `blobUrl` cambia en cada `PREVIEW_UPDATED` aunque los píxeles sean los mismos (el motor acuña un `URL.createObjectURL` nuevo también en aciertos de cache, ADR-056 §6), asignarlas incondicionalmente al re-ejecutarse el efecto dejaba la página en gris hasta que la `Image` nueva terminaba de cargar: ese era el parpadeo constante que se veía al scrollear. La comprobación va en una **función pura testeable en Node** (los tests de `apps/react-client` corren sin jsdom), no en un `if` inline sin cobertura.
- **Interacción**:
  - Hover sobre highlight → tooltip.
  - Click en highlight → selecciona grupo en `entities` store + scroll into view en `EntitiesPanel`.

### 5.5 `ZoomControls`

- **Botones**: `+`, `-`, `Reset`.
- **Atajos**: `Cmd/Ctrl++`, `Cmd/Ctrl+-`, `Cmd/Ctrl+0`.
- **Acción**: `viewer.setZoom(newZoom)` (aplica el escalado CSS inmediato vía `PdfViewer` §5.2); el re-render real se dispara con debounce, no en cada click/atajo individual (`ZOOM_RERENDER_DEBOUNCE_MS = 150 ms`, ADR-037 §5).

### 5.6 `ScrollSyncToggle` (ADR-054 §2)

- **Ubicación**: la barra del visor, junto a `ZoomControls`. Es un control **del visor**, hermano del zoom — no del `Toolbar` (acciones sobre el documento: exportar, cancelar, cerrar) ni del `SettingsDialog` (configuración de procesamiento: NER, idiomas de OCR, preset).
- **Store**: `settings.scrollSyncEnabled` (persistido en `localStorage`; default `false`).
- **Visibilidad**: solo en anchos `≥ lg` (`hidden lg:flex`), la misma media query con la que `SideBySideViewer` alterna a tabs. Por debajo hay un solo panel visible y sincronizar dos paneles que no se ven a la vez no significa nada.
- **Al ocultarse no se apaga**: la preferencia se conserva intacta; al volver a ancho `≥ lg` el control reaparece con el valor que tenía y los paneles se realinean. Resetearla al redimensionar pisaría una elección que el usuario no tocó.
- **Efecto**: ver `SideBySideViewer` §5.1 (sincronización a nivel de píxel, idempotente, sin temporizadores).

---

## 6. Componentes de Conflicto

### 6.1 `ConflictBadge`

- **Render**: icono ⚠ con tooltip "Conflicto".
- **Click**: abre `ConflictDialog`.

### 6.2 `ConflictDialog`

- **Props**: `conflictId`.
- **Stores**: `entities.conflicts`.
- **Render**: ver `UX_Guidelines.md` §6. Muestra razón, candidatos, resolución sugerida.
- **Acción**: `actions.resolveConflict(conflictId, mode)`.

---

## 7. Componentes de Export

### 7.1 `ExportDialog`

- **Stores**: `document`, `entities`, `settings`.
- **Render**: ver `UX_Guidelines.md` §8.2. Form con nombre, formato, calidad, DPI, título.
- **Pre-flight**: si `enabledGroups = 0`, modal de confirmación anidado.
- **Acción**: `actions.requestExport(options)`.

### 7.2 `ExportProgress`

- **Stores**: `pipeline.exportProgress`.
- **Render**: barra de progreso con `current/total`.
- **Al finalizar** (`pipeline.exportResult != null`): botón "Descargar" (ancla a `blobUrl`) + "Exportar otro".

---

## 8. Componentes comunes

### 8.1 `Button`

- Variantes: `primary`, `secondary`, `ghost`, `danger`.
- Tamaños: `sm`, `md`, `lg`.
- Props estándar + `loading?: boolean`.

### 8.2 `Dialog`

- Wrapper sobre Radix `Dialog` con focus trap, escape para cerrar, backdrop.
- Props: `open`, `onClose`, `title`, `children`.

### 8.2b `ConfirmDialog` (ADR-036 §7)

- Confirmación genérica sobre `Dialog`; ya era referenciado por `CancelButton` (§2.4), `GroupContextMenu` (§3.5) y `RuleItem` (§4.2) sin estar en el catálogo.
- Props: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `variant?: "danger"`, `onConfirm`, `onCancel`.
- Usos MVP: cancelar pipeline (`UX_Guidelines.md` §7.3), deshabilitar grupo, borrar regla, reanalizar por cambio de settings (§2.6).

### 8.3 `Select`

- Wrapper sobre Radix `Select` con estilos Tailwind.
- Props: `value`, `onChange`, `options`.

### 8.4 `Checkbox`

- Wrapper sobre Radix `Checkbox`.
- Estados: `checked`, `unchecked`, `indeterminate` (para cascade de tipos).

### 8.5 `Tooltip`

- Wrapper sobre Radix `Tooltip` con delay corto.

### 8.6 `Toast`

- Wrapper sobre Radix `Toast` (o `sonner` si se agrega con ADR).
- Tipos: `info`, `success`, `warning`, `error`.

### 8.7 `Banner`

- Para mensajes persistentes (warning de NER desactivado, no grupos habilitados, etc.).
- Variantes: `info`, `warning`, `error`.
- Dismissible (con persistencia en `settings`).

### 8.8 `Skeleton`

- Placeholder gris para páginas en carga.
- Props: `width`, `height`.

---

## 9. Paleta de colores (highlights por tipo)

Paleta accesible (contrast ≥ 3:1 con fondo blanco), diferenciada también por patrón de borde:

| Tipo | Color | Patrón de borde |
|---|---|---|
| Person | `#10b981` (verde) | sólido |
| Organization | `#6366f1` (índigo) | sólido |
| Address | `#f59e0b` (ámbar) | sólido |
| DNI | `#3b82f6` (azul) | sólido |
| CUIT | `#3b82f6` (azul) | punteado |
| Phone | `#8b5cf6` (violeta) | sólido |
| Email | `#8b5cf6` (violeta) | punteado |
| IBAN | `#ec4899` (rosa) | sólido |
| CreditCard | `#ec4899` (rosa) | punteado |
| Date | `#14b8a6` (teal) | sólido |
| License | `#a855f7` (púrpura) | sólido |
| Plate | `#a855f7` (púrpura) | punteado |
| Custom | `#64748b` (slate) | sólido |
| Conflicto | `#ef4444` (rojo) | doble |

El patrón de borde (sólido/punteado/doble) permite distinguir tipos incluso para usuarios con visión monocromática o daltonismo.

---

## 10. Tokens de diseño

```css
/* Tailwind config extend */
--color-bg-primary: #ffffff;
--color-bg-secondary: #f9fafb;
--color-bg-tertiary: #f3f4f6;
--color-border: #e5e7eb;
--color-text-primary: #111827;
--color-text-secondary: #6b7280;
--color-accent: #3b82f6;       /* azul primario */
--color-success: #10b981;
--color-warning: #f59e0b;
--color-error: #ef4444;
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.1);
```

Modo oscuro: en v1.0. MVP es solo claro.

---

## 11. Iconografía

- Iconos: `lucide-react` (open source, consistente, tree-shakeable).
- Tamaños: 16 px (inline), 20 px (botones), 24 px (toolbar), 32 px (hero).
- `aria-label` siempre que el icono sea interactivo.

---

## 12. Mapeo Componente → Core

| Componente | Lee del store | Dispara acción | Evento Core |
|---|---|---|---|
| `ImportButton` | – | `actions.importDocument` → `orchestrator.importDocument` | `DOCUMENT_IMPORTED` (lo emite el Orchestrator; la UI nunca invoca `pdf.process` — errata corregida, ADR-036 §7) |
| `PasswordDialog` | `document` | `actions.retryWithPassword` → `orchestrator.retryWithPassword` | (escucha `PDF_PASSWORD_REQUIRED`, canal `pdf`) |
| `SettingsDialog` | `settings`, `document` | `settings.persist` (+ `actions.reanalyze` si `nerEnabled`/`ocrLanguages` cambian con documento abierto, `React_Client.md` §3.7, ADR-038 §7) | `orchestrator.reanalyze` (no es un evento del bus) |
| `CancelButton` | `pipeline.stage` | `actions.cancel` | `CANCEL_REQUESTED` |
| `CloseDocumentButton` (ADR-051) | `pipeline.stage`, `document` | `actions.closeDocument` (vía `ConfirmDialog`) → `orchestrator.closeDocument` | `DOCUMENT_CLOSED` |
| `ExportButton` | `pipeline.stage`, `document` | `actions.requestExport` (via dialog) | `EXPORT_REQUESTED` |
| `EntityGroupItem` (checkbox) | `entities.groupsByType` | `actions.updateGroup` | `GROUP_UPDATE_REQUESTED` |
| `ReplacementModeSelect` | `entities.groupsByType` | `actions.updateGroup` | `GROUP_UPDATE_REQUESTED` |
| `MergeDialog` | `entities.groupsByType` | `actions.mergeGroups` | `GROUP_MERGE_REQUESTED` |
| `SplitDialog` | `entities.groupsByType` | `actions.splitGroup` | `GROUP_SPLIT_REQUESTED` |
| `RuleCreatorDialog` | `entities`, `rules` | `actions.createRule` | `RULE_CREATED` |
| `RuleEditorDialog` | `rules` | `actions.updateRule` | `RULE_UPDATED` |
| `RuleItem` (delete) | `rules` | `actions.deleteRule` | `RULE_DELETED` |
| `ConflictDialog` | `entities.conflicts` | `actions.resolveConflict` | `CONFLICT_RESOLVE_REQUESTED` |
| `PdfViewer` | `viewer`, `document` | (via `actions.requestRender`) | `RENDER_REQUESTED` |
| `PageCanvas` (click highlight) | `entities` | selecciona grupo en store local | (ninguno, solo local) |
| `ExportDialog` | `document`, `entities` | `actions.requestExport` | `EXPORT_REQUESTED` |

---

## 13. Reglas de implementación

1. Los componentes **nunca** importan del Core directamente. Solo via `core-adapter`.
2. Los componentes **nunca** mutar el store directamente. Siempre via `actions`.
3. Los componentes son **presentacionales**: datos via props o selectors finos de Zustand.
4. Selectors: `useEntitiesStore(s => s.groupsByType.get(type))` para evitar re-renders.
5. Memoización: `React.memo` en items de lista larga (`EntityGroupItem`, `PageCanvas`).
6. Sin `useEffect` para lógica de negocio; solo para suscripciones del adapter (que viven en `core-adapter`, no en componentes).
7. Accesibilidad: todos los componentes interactivos pasan por wrappers de Radix (que son accesibles por default).
8. Sin `dangerouslySetInnerHTML`. Sin `eval`. Sin `innerHtml`.
9. **Auto-gating vs. diálogos hijos (bug #7 del Escenario 1 E2E, 2026-07-22)**: un componente que se auto-oculta por `stage` y renderiza un diálogo hijo controlado por estado local **nunca desmonta el diálogo mientras esté abierto** — el gate condiciona el trigger (botón), no la vida del diálogo: `if (!visible && !open) return null`. `stage` puede cambiar por debajo de un diálogo abierto en cualquier momento (el pipeline es asíncrono); desmontar destruye el estado en vuelo del diálogo. Aplica a `ExportButton` (§2.5) y a cualquier componente con el mismo patrón (`CancelButton` + `ConfirmDialog`, §2.4).

---

## 14. Referencias

- `ui/React_Client.md` (UI Contract)
- `ui/UX_Guidelines.md` (patrones UX)
- `ADR-001-Framework.md` (stack)
- `ADR-005-State-Management.md` (Zustand + bus)
- `04_Event_System.md` §10 (eventos de UI)
- `03_Data_Model.md` (tipos consumidos)
- `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` (zoom real, §5.2/§5.5)
- `adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` (`SettingsDialog` → `reanalyze`, §2.6/§12)
