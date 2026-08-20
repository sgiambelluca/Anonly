<!-- CONTEXT: scope=componentes-ui | dependencias=ui/React_Client.md,ui/UX_Guidelines.md,ADR-001-Framework.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-071-El-Genero-Se-Muestra-Solo-Donde-Se-Usa.md | audiencia=IA-implementador-ui | fase=4 (reconciliado en fase 10 por ADR-036: PasswordDialog/SettingsDialog/ConfirmDialog agregados §2.6–2.7/§8.9, zoom §5.2, mapeo §12; §2.6/§5.2/§5.5/§12 reescritos por ADR-037 —zoom con re-render real— y ADR-038 —SettingsDialog dispara reanalyze, no recreación del core—; §2.1/§2.5/§13.9 ajustados 2026-07-22 por el bug #7 del Escenario 1 E2E: gate de visibilidad por stage vs. vida del diálogo hijo abierto; §5.2/§5.4 en fase 11 por ADR-056 —requestRender con kind por panel, canvas que no se borra—; §3.3/§3.4/§7.1/§12 en fase 10.5 por ADR-058 —marca de reemplazo degradado— y ADR-059 —checkbox de leyenda—; §3.3 por ADR-062 —el canal `PREVIEW_UPDATED.degraded` del que sale esa marca, y las tres reglas de su consumo; el checkbox de leyenda entra en el Hito 10.5 y la marca queda para después—; §3.3/§3.4b/§12 en fase 10.6 por ADR-060 —PersonGenderSelect y marca de género sin determinar— y ADR-069 —§3.4b actualizado: el patch usa `PersonGenderChoice`, "sin determinar" viaja como `"neutral"` explícito—; §3.3/§3.4b/§8.3/§12 reescritos en fase 10.6 por ADR-071 —`PersonGenderSelect` pasa a ser `PersonGenderToggle`: visible solo en `placeholder`/`synthetic`, botón cíclico de tres estados con SVG propios, la marca de "sin determinar" fusionada con el estado neutro, y `Select` sin apertura controlada—; §3.4c/§5.4b/§5.4c/§12 en fase 10.7 por ADR-061 —agregado manual, hit-test de selección y buscador—; §1/§2.6 en fase 10.6 por ADR-070 —sección "Acerca de" con la atribución CC-BY dentro del SettingsDialog, y `thirdPartyCredits.ts` como módulo de datos—) -->

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
│   ├── thirdPartyCredits.ts  // ADR-070 §2 (datos, no componente)
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
  - `stage ∈ {Ready, Done}`: `PipelineStatus` + `ExportButton` + `CloseDocumentButton` + `CancelButton` (§2.4). (`Done` no tenía fila — gap cerrado al resolver el bug #7 del Escenario 1 E2E: tras un export el documento sigue abierto y re-exportable. `CloseDocumentButton` agregado por ADR-051.)
  - `stage === Rendering/Exporting`: `PipelineStatus` + `CancelButton`.
  - `stage === Failed`: banner de error + "Reintentar" o "Cerrar" (el "Cerrar" del banner, sin confirmación) + `CloseDocumentButton`.
  - `stage === Cancelled`: `PipelineStatus` + `CloseDocumentButton`.

  > **Reconciliación con §2.4 (2026-08-18)**: la fila `{Ready, Done}` decía "(+ `CancelButton` si hay jobs remanentes)", un matiz que §2.4 —la regla canónica del propio componente— nunca tuvo. No existe ningún campo en `pipeline.store` que represente "jobs remanentes", ni ninguno planificado, así que el matiz era inimplementable y quedó sin implementar desde el PR6 del Hito 10 (`CancelButton.tsx` sigue la regla de §2.4: visible cuando `stage ∉ {Idle, Done, Failed, Cancelled}`). Se elimina el matiz en vez de inventar el campo: **§2.4 manda**, y en `Ready` el botón se muestra como en cualquier otro stage no terminal.

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
- **Sección "Acerca de"** (ADR-070): bloque **estático** al pie del diálogo, separado del formulario por un divisor, con la atribución de datos de terceros. Es obligación de licencia CC-BY (ADR-060 §11), no una cortesía.
  - **Contenido**: una entrada por cada elemento de `THIRD_PARTY_CREDITS` (`toolbar/thirdPartyCredits.ts`, ADR-070 §2), con título de la obra, titular, licencia, indicación de cambios y para qué la usa Anonly. Hoy hay **una**: el léxico de nombres de Buenos Aires Data (CC-BY-2.5-AR).
  - **Enlaces**: el título enlaza a `sourceUrl` y el nombre de la licencia a `licenseUrl`, ambos `target="_blank" rel="noopener noreferrer"`. Son las **únicas** URLs externas navegables del producto: agregar otra requiere ADR (ADR-070 §3). No son requests de la app — `connect-src 'self'` sigue sin excepciones (`08_Security_Model.md` §3.2).
  - **Fuera del guardado atómico**: no lee ni escribe `settings.store`, no entra en `diffReanalyzeChange`, y "Cancelar"/"Guardar" no lo afectan. La garantía de §2.6 —si el usuario cancela, ningún campo se aplica— no admite excepciones.
  - **ARIA**: `<section aria-label="Acerca de">` con encabezado visible; los enlaces son `<a>` nativos (accesibles por teclado sin wrapper).
  - **Sincronización**: el contenido de la entrada del léxico coincide con `gender-lexicon.provenance.json` y con `NOTICE`, y un test lo verifica (ADR-070 §5) — no se sostiene por disciplina.

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
  - **reemplazo degradado** (ADR-058 §7, canal por ADR-062): alguna ocurrencia del grupo recibió `AnnotationKind.Degraded` — el token hubo que encogerlo por debajo de `DEGRADED_FONT_RATIO` y quedó comprometido. Es una marca **accionable**, no informativa: existe porque la palanca para arreglarlo ya existía y era invisible. Al abrirla, ofrece las tres salidas —editar el `replacementValue` a mano, cambiar el modo a `redact` (que no tiene problema de espacio) o deshabilitar el grupo—. **No** aparece cada vez que el repintado de línea no se activó: solo bajo el umbral, para que la señal signifique algo.

    **De dónde sale el dato (ADR-062)**: de `PREVIEW_UPDATED.degraded`, no de `EntityGroup` —que no tiene ni va a tener un campo para esto (ADR-062 §5: es un veredicto de Render, no un atributo del grupo)— y **nunca** de una estimación cliente-side con `estimateTokenWidth`, que sería una tercera fuente de verdad capaz de discrepar del preview y del export (ADR-062 §"Alternativas"). Tres reglas duras del consumo, cada una con su test:

    - **Mapa `pageIndex → Degraded[]` por documento, con reemplazo por página, nunca acumulación** (§3). Es lo que hace que la marca se apague sola cuando el usuario corrige el grupo: la edición invalida el cache, la página se re-renderiza y llega un `degraded` vacío. Sin reemplazo, la marca queda encendida para siempre y el usuario no puede saber si su corrección funcionó.
    - **Descartar los eventos con `kind: "original"`** (§3). Ese panel no pinta reemplazos y manda el array vacío por construcción; sin el filtro, borra el veredicto legítimo del panel anonimizado de la misma página.
    - **`degraded` ausente ≡ `[]`** (§2): se lee `payload.degraded ?? []` y no se distinguen nunca.

    La marca del árbol es la **agregación derivada** de ese mapa: el conjunto de `groupId` con al menos una ocurrencia degradada. No se persiste ni vuelve al Core. La cobertura es completa desde `Ready` sin renderizar nada de más, porque el seed de ADR-044 ya siembra todas las páginas con reemplazos (ADR-062, Contexto §3), y vale igual para el PDF exportado por la invariancia de escala del umbral (ADR-062 §6).
  - **género sin determinar** (ADR-060 §5, **fusionado con el control por ADR-071 §4**): ya **no** es un badge propio. Es el **estado neutro del `PersonGenderToggle` de §3.4b**, con trazo atenuado, y por lo tanto aparece exactamente donde aparece el control: grupos `Person` en modo `placeholder` o `synthetic`. Sigue siendo una **afordancia de UI sobre información faltante**, distinta de la marca de degradación —el grupo se renderiza perfecto, lo que falta es un dato—, así que **no** usa `AnnotationKind.Degraded` ni se pinta en el canvas. Lo que se retira es la duplicación: antes había un badge `?` **más** el selector, los dos sobre el mismo campo.
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
- **Nota (ADR-057)**: el preview es `group.replacementValue`, ya resuelto por el Grouping Engine — así que **muestra el token abreviado sin ningún cambio en este componente**. Un grupo apretado va a previsualizar `[PRS-01]` y no `[PERSONA 01]`, y eso es correcto: es exactamente lo que va a salir en el documento.

### 3.4b `PersonGenderToggle` (ADR-060 §6, forma y visibilidad por ADR-071 §1-§3, wire por ADR-069 §4)

> **Reemplaza a `PersonGenderSelect`**, que era un `Select` montado en **toda** fila `Person` sin mirar el modo. Con eso, un documento con veinte personas mostraba veinte campos que la mayoría de los usuarios no toca nunca, compitiendo con el control que sí se usa en cada grupo. ADR-071 §1-§4.

- **Props**: `groupId`, `currentGender: PersonGender | undefined` — el valor **almacenado** en el grupo (`EntityGroup.personGender` no cambió de forma, ADR-069 §4).
- **Visibilidad**: `type === EntityType.Person` **y** `replacementMode ∈ { placeholder, synthetic }` — los dos únicos modos cuyo valor depende de `personGender`. En `mask` y `redact` el control sería una palanca sin nada del otro lado. La condición vive en `isPersonGenderToggleVisible(group)` (`personGenderVisibility.ts`), función pura, y **reemplaza a las dos anteriores** (`isPersonGenderSelectVisible` + `isPersonGenderUndeterminedMarkVisible`).
  - Leer `group.replacementMode` es correcto: el motor le escribe encima el resultado de `resolveMode()` en cada mutación, así que ese campo **siempre lleva el modo efectivo**, ya resuelto contra las reglas de grupo/tipo/globales. La UI no replica la escalera de prioridades y no puede desincronizarse de ella.
- **Forma**: un `<button>` del ancho de un icono que muestra el estado actual y **cicla** al siguiente con un click: `neutral → f → m → neutral`. El neutro es el estado de reposo de un grupo sin resolver, y ♀ antes que ♂ es el orden en que se conocen los símbolos.
- **Símbolos**: SVG **first-party**, los tres sobre la misma grilla de 16×16 para que el botón no salte al ciclar — `lucide-react@0.451.0` no tiene `Venus`/`Mars`, y el glifo Unicode del neutro (`U+26B2`) tiene cobertura de fuente irregular.

  | Estado | Símbolo | Forma |
  |---|---|---|
  | `f` | ♀ | círculo con cruz abajo |
  | `m` | ♂ | círculo con flecha arriba-derecha |
  | `neutral` | ⚲ | **el mismo círculo, sin apéndice** |

  **El neutro no es un símbolo de identidad de género, y eso no es negociable**: significa *sin determinar* —falta el dato, o el nombre no lo determina—, no una tercera categoría de persona. Nada de ⚧ ni equivalentes. ADR-060 §9 ya lo fijó para el valor `A` del registro ("es una propiedad del **nombre**, no un atributo de quien lo lleva") y ADR-060 §"Alternativas" rechazó por escrito agregar categorías.
- **El estado neutro ES la marca de "género sin determinar"** (ADR-071 §4, supersede ADR-060 §5): trazo atenuado frente a los estados resueltos. No hay badge separado — la marca es el control, así que el "acceso directo a corregirlo" que pedía ADR-060 §5 es el propio click.
- **El estado mostrado sale de `group.personGender`**, venga de una inferencia o del usuario: un grupo con género inferido aparece con su símbolo sin ninguna interacción previa. El control no tiene estado propio.
- **Acción**: `actions.updateGroup(groupId, { personGender: choice })`, donde `choice: PersonGenderChoice` (`"f" | "m" | "neutral"`, `Contracts.md` §8). "Sin determinar" emite el valor explícito `"neutral"` — **no** ausencia de clave — que es lo que permite distinguir "el usuario eligió volver a neutral" de "no se tocó este campo" (ADR-069 §4). El motor traduce `"neutral"` a borrar `EntityGroup.personGender`. **El wire no cambió con ADR-071.**
- **El ciclo es una función pura**, `nextPersonGenderChoice(current)` en `personGenderOptions.ts`: `apps/react-client` corre sus tests en Node sin jsdom, así que es la única forma de testearlo sin renderizar (mismo criterio que `personGenderVisibility.ts` y `entityTree.ts`).
- **ARIA** (`UX_Guidelines.md` §9): `aria-label` que nombra el estado actual **y** el siguiente (`"Género: femenino. Cambiar a masculino."`), `Tooltip` con el estado actual al hover, foco visible, contraste AA 3:1 en los dos tratamientos (resuelto y atenuado). Es un `<button>` nativo: Enter y Espacio funcionan sin código.
- **Efecto sobre el token**: el preview se actualiza en el acto igual que al cambiar de modo, y ahora **en los dos modos** — `[MUJER 03]` / `[HOMBRE 03]` / `[PERSONA 03]` en `placeholder`, y un nombre sintético del género elegido en `synthetic` (ADR-071 §5).
- **Por qué es por grupo y no un ajuste global**: el género es un atributo sensible que el token neutro ocultaba (`08_Security_Model.md` §9.1). Se divulga de a una persona por vez, con el usuario mirando. No hay —ni debe haber— una casilla que lo active sobre todo el documento. **Esto es lo único de ADR-060 §6 que ADR-071 no toca, y es su decisión de fondo.**

### 3.4c `AddEntityButton` + `AddEntityDialog` (ADR-061 §3, ruta A)

- **Ubicación**: sobre el árbol de entidades, encima de las coincidencias ya encontradas.
- **Render del diálogo**: selector de `EntityType` + campo de texto para el valor + confirmar.
- **Acción**: `actions.addManualEntity({ value, entityType })` → `ManualEntityResult` con `occurrenceCount` (errata de ADR-061 §6). El adaptador devuelve `ManualEntityResult | null`: `null` **solo** cuando no hay documento activo —un estado en el que el diálogo no puede estar abierto— y el diálogo lo trata como "no hacer nada", **nunca** como "no se encontró".
- **Sin coincidencias**: `occurrenceCount === 0` → **no se creó grupo** y el diálogo lo informa ("no se encontró ese texto en el documento"), sin cerrarse, para que el usuario corrija un typo y reintente. **No es un error y no llega por excepción**: es el valor de retorno (ADR-061 §6 y su errata). Un `try/catch` acá sería para los `InvalidInputError` reales (documento inexistente, stage inválido), que son otra cosa.
- **Con coincidencias**: `occurrenceCount > 0` → se cierra e informa éxito. El número son **apariciones del valor en el documento**, antes del dedup; no es "cuántos grupos se crearon" ni "cuántas ocurrencias se sumaron". Si el copy muestra el número, tiene que decir "se encontraron N apariciones" — decir "se agregaron N" mentiría en el caso de fusión.
- **Valor ya detectado**: se fusiona en el grupo existente en vez de duplicar — lo resuelve el dedup por identidad de ADR-038 §3, sin nada que implementar acá. Devuelve `occurrenceCount > 0` aunque el árbol no cambie, y eso es lo correcto: para el usuario la entidad quedó cubierta.
- **Advertencia de alcance en el copy**: la búsqueda es **exacta** (insensible a mayúsculas y acentos). Si el documento nombra a la persona de dos formas —"José Pérez" y "J. Pérez"— hay que agregar las dos. Decirlo en el diálogo evita el reporte de "no encontró todas". Limitación de ADR-061 §2, anotada en `Future_Ideas.md` §5.1b.

### 3.5 `GroupContextMenu`

- **Trigger**: botón `[⋯]` en `EntityGroupItem`.
- **Opciones**:
  - "Fusionar con…" → `MergeDialog`.
  - "Dividir…" → `SplitDialog`.
  - **"Ver ocurrencias"** (ADR-084 §2) → escribe `group.canonicalValue` en `viewer.store.searchQuery`. El `DocumentSearchBox` (§5.4c) reacciona solo: busca, cuenta y deja anterior/siguiente listos para recorrer el documento resaltando cada aparición. **No se construye un popover propio**: el buscador ya scrollea, resalta y navega — el popover de la redacción anterior (que además pedía un `value` por ocurrencia que `OccurrenceRef` no tiene) habría sido una segunda UI de navegación, peor que la que existe.
    - **El contador del buscador puede no coincidir con el `(N)` del grupo**, y está bien (ADR-084 §3): `findText` busca el literal, `members` son las ocurrencias agrupadas. Un grupo con aliases tiene members que la búsqueda del canónico no encuentra; y la búsqueda puede encontrar apariciones que el detector no agrupó — que es justamente el recall que ADR-061 cubre, con el "Agregar como…" de cada resultado a mano.
  - **"Cambiar categoría"** (ADR-082 §6) → `ChangeTypeDialog` (§3.8): `Select` con todos los `EntityType`, preseleccionado en el actual → `actions.updateGroup(groupId, { type })`. Sin `ConfirmDialog`: es reversible volviendo a elegir el tipo anterior.
  - **"Restaurar valor calculado"** (ADR-078 §4) → **solo** si `group.replacementValueUserSet`; despacha `actions.updateGroup(groupId, { replacementMode: <el mismo modo> })`, que recalcula el valor y apaga el flag sin API nueva.
  - "Editar valor canónico" → input inline.
  - "Eliminar grupo" → `ConfirmDialog` → `actions.updateGroup(groupId, { enabled: false })` (no se elimina, se deshabilita; en MVP no se elimina completamente).

> **Accesibilidad**: el menú es un disclosure hecho a mano (trigger con `aria-expanded` + panel `role="group"` con botones, cierre por click-fuera/Escape/selección), sin `@radix-ui/react-dropdown-menu` — agregar esa dependencia requiere ADR (P-9/R-12). Los items se recorren con **Tab**, no con flechas.
>
> **No usa `role="menu"`/`role="menuitem"` ni `aria-haspopup`**, y es deliberado (2026-08-20). Ese rol es un contrato con el lector de pantalla: promete navegación por flechas, Home/End y foco gestionado con un solo tab stop, y nada de eso está implementado. Anunciarlo igual deja al usuario de teclado apretando flechas contra un panel que no responde — peor que no anunciar nada, porque sin el rol son botones en un grupo etiquetado y se comportan como el lector espera. `aria-haspopup="true"` sale por lo mismo: en WAI-ARIA 1.1+ es **sinónimo de `menu`**, así que reintroducía la promesa por la puerta de atrás. Si algún día entra Radix, trae el rol **y** el manejo de foco juntos, que es la única forma correcta de tener el primero.

### 3.8 `ChangeTypeDialog` (ADR-082 §6)

- **Props**: `groupId`, `currentType`, `canonicalValue`.
- **Acción**: `actions.updateGroup(groupId, { type })`. Un tipo igual al vigente es no-op (el motor no emite nada, ADR-082 §1) y el diálogo además se ahorra el viaje.
- **Por qué existe**: el tipo no es una etiqueta suelta — gobierna el token del documento anonimizado, su numeración por tipo, qué regla de scope `type` aplica y de qué pool sortea el sintetizador. Un tipo equivocado produce un documento que **afirma algo falso** sobre el dato que ocultó.

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

- **Props**: `kind`, `pageCount`, `renderItem: (index) => ReactNode`, `visibleRange`, `pageSize`, `pageWidth`, `onVisibleRangeChange`, `onCurrentPageIndexChange`, `scrollSync`. **Sin `scrollToPageIndex`** (ADR-054 §6): esa prop y el efecto de sincronización que la consumía se retiran junto con `scrollSync.ts`/`computeScrollSyncTarget` — con scroll independiente no existe el concepto de seguidor, y con la sincronización prendida la mecánica es la de §5.1, que no pasa por props.
  - `kind`: identifica el panel para registrarse en `scrollSync` y para derivar/reportar su propia página actual.
  - `pageWidth` (post-Hito 10.7, hallazgo post-`APPROVED` 2026-08-15): el ancho de página en CSS px, mismo `pageWidth` que `PdfViewer` ya calcula. El contenedor con scroll lo usa como `width: max(pageWidth, 100%)` — no el 100% implícito de un bloque — para que a zoom alto, cuando `pageWidth` supera el ancho del panel, el contenedor **crezca** en vez de dejar que `PagePhantom` (`inset-x-0`) centre por flex un `renderItem` más ancho que él: ese centrado desborda por igual a los dos lados, pero un navegador en LTR solo cuenta el desborde a la **derecha** como `scrollWidth` — el borde izquierdo de la página queda a `scrollLeft` negativo, inalcanzable. Con el contenedor ya del ancho correcto, todo el desborde cae a la derecha y se alcanza scrolleando.
  - `onVisibleRangeChange`: reporta al rango que detecta el `IntersectionObserver` (rango de **montaje** únicamente, ADR-054 §5) — cierra el loop de "usa `IntersectionObserver` para detectar visibilidad" hacia el estado controlado por `PdfViewer`.
  - `onCurrentPageIndexChange(pageIndex)`: página actual derivada por geometría de scroll (ADR-054 §5), reportada solo cuando cambia.
  - `scrollSync`: controller de sincronización opcional de scroll (ADR-054 §3), instanciado una sola vez por `SideBySideViewer` y compartido entre sus dos `PdfViewer`/`PageVirtualizer`.
- **Comportamiento**: mantiene un pool de `<canvas>` reutilizables. Calcula scroll height total con `pageCount × pageSize`. Solo renderiza items en `visibleRange` + 1 antes + 1 después. El contenedor con scroll es `overflow-auto` en los dos ejes (antes solo `overflow-y-auto`; el eje horizontal lo necesita `pageWidth` arriba).
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

### 5.4b `WordSelectionOverlay` (ADR-061 §3/§4, ruta B)

- **Solo sobre el panel `original`.** En el `anonymized` el texto visible puede ser un reemplazo, y señalarlo no significaría nada.
- **Interacción**: click sobre una palabra, o arrastre de un recuadro sobre varias. Al soltar, aparece "Agregar entidad como…" con el selector de `EntityType`.
- **Cómo resuelve qué se señaló**: **hit-test contra `Page.words`, no selección de texto**. El overlay traduce coordenadas de pantalla a coordenadas de página y aplica `wordsInRect(words, rect)` (función pura de `@anonly/shared`). Los datos salen de `actions.getPageWords(pageIndex)` — el adaptador (`actions.ts`) resuelve el documento activo por su cuenta, mismo criterio que el resto de `actions.*` (§3.4c).
- **Por qué no una capa de texto de pdf.js**: en un PDF escaneado **no hay texto** — es una foto —, y es justo donde más falta hace corregir a mano. Las palabras de OCR tienen bbox igual que las de PDF, así que el hit-test no distingue el origen y no hay una rama por tipo de documento. Además evita meter pdf.js en el cliente y una copia del texto original en el DOM (ADR-061 §4).
- **Coordenadas**: usa `getPageSize` para el mapeo, **no** la estimación de `pageLayout.ts`. Con zoom, el factor de escala del visor entra en la misma transformación.
- **Acción**: `actions.addManualEntity({ value, entityType })` con el texto de las palabras señaladas.

### 5.4c `DocumentSearchBox` (ADR-061 §8)

- **Ubicación**: junto al encabezado "PDF ORIGINAL", con icono de lupa (punto 4 de `Cambios para hacer.txt`).
- **La consulta vive en `viewer.store.searchQuery`** (ADR-084 §1), no en el estado local del componente: "Ver ocurrencias" del panel de entidades (§3.5) la escribe desde el otro extremo del árbol. **No es por panel** —a diferencia de `currentPageIndex`/`visibleRange` desde ADR-054 §1— porque el buscador existe una sola vez, sobre el `original`. El resto de su estado (matches, `activeIndex`, el tipo del "Agregar como…") **sigue siendo local**: es trabajo interno suyo.
- **Acción**: `actions.findText(query)` → `TextMatch[]` con bbox por coincidencia (el adaptador resuelve el documento activo por su cuenta, igual que `getPageWords`/`getPageSize`). Consulta **sincrónica** y de solo lectura: buscar no crea grupos ni modifica la sesión (errata de ADR-061 §8).
- **El debounce es de este componente**: `findText` es sincrónica y recorre todas las palabras del documento en el main thread, así que una llamada por tecla se nota en documentos largos. El Core no amortigua —es una función de consulta, sin estado ni cache (`Regex_Engine.md` §12)—, así que la caja de búsqueda debe hacerlo, mismo criterio que el re-render del zoom (§5.5). Los resultados vienen en orden documental, así que "anterior/siguiente" navega el array tal cual, sin re-ordenar.
- **Render**: contador de resultados, navegación anterior/siguiente con scroll a la página, y resaltado del match activo sobre el canvas (reusa el mismo overlay de §5.4b).
- **Tercera vía de agregado**: cada resultado ofrece "agregar como entidad", que abre el selector de tipo y llama a `addManualEntity`. Sale gratis: es la misma búsqueda literal que alimenta el agregado manual (ADR-061 §8). **Agrega todas las apariciones del valor, no solo el resultado clickeado** — `addManualEntity` recorre el documento entero, que es el comportamiento correcto para una entidad manual; el copy debe decirlo para que no se lea como que anonimiza solo esa coincidencia.

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
- **Render** (ADR-083 §6): el valor en disputa + los **tipos de entidad** candidatos como radios, con el de mayor `confidence` preseleccionado. **No nombra a Regex ni a NER** ni muestra números de confidence: son detalles de implementación del pipeline, y la pregunta útil es una sola — ¿esto es una organización o una dirección?
- **Acción**: `actions.resolveConflict(conflictId, entityType?)`. Aplicar **reclasifica el grupo** por la vía de ADR-082 §2 y marca el conflicto resuelto. Sin tipo elegido, el motor aplica su default (mayor confidence), que coincide con la clasificación ya vigente: confirmar no cambia datos.
- **Cuando no hay elección**: si todos los candidatos comparten tipo (`low_confidence`/`ambiguous_canonical`, que no son conflictos de clasificación), el diálogo no ofrece radios y el botón dice "Descartar".
- **Qué cambió y por qué** (ADR-083): hasta este ADR el diálogo pedía un `ReplacementMode`, que **no resolvía el desacuerdo** — `applyConflictResolve` no tocaba el `entityType`, así que el usuario aplicaba y la discrepancia quedaba igual. El modo de reemplazo se sigue eligiendo donde siempre: el `ReplacementModeSelect` de la fila del grupo (§3.4).

---

## 7. Componentes de Export

### 7.1 `ExportDialog`

- **Stores**: `document`, `entities`, `settings`.
- **Render**: ver `UX_Guidelines.md` §8.2. Form con nombre, formato, calidad, DPI, título y **checkbox "Incluir referencia de marcadores"** (ADR-059 §1, default **apagado**).
- **Pre-flight**: si `enabledGroups = 0`, modal de confirmación anidado.
- **Acción**: `actions.requestExport(options)` con `includeMarkerLegend`.
- **Sobre el checkbox de leyenda** (ADR-059): agrega una página final con la referencia `prefijo → tipo` — `MAT` y `PAT` no se leen solos, y son matrícula y patente. El copy tiene que dejar claras las dos cosas que el usuario necesita saber para decidir: que **suma una página** al documento, y que lista **tipos, nunca los valores originales**. Lo segundo importa: es lo primero que un usuario asume que hace, y no lo hace ni puede hacerlo.

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
- **Sin apertura controlada** (ADR-071 §4). El PR 12 le agregó `open`/`onOpenChange` para un solo caso: que el badge de "género sin determinar" pudiera abrir el desplegable de un componente **hermano**. Al fusionarse la marca con el control (§3.4b), ese caso desaparece y las props se retiran — un componente compartido no lleva superficie que usa un consumidor y que ya no existe.

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
| `PersonGenderToggle` (ADR-060 §6, ADR-071 §1-§4) | `entities.groupsByType` | `actions.updateGroup({ personGender })` | `GROUP_UPDATE_REQUESTED` |
| `AddEntityDialog` (ADR-061 §3) | `document` | `actions.addManualEntity` → `orchestrator.addManualEntity` | `ENTITY_FOUND` (`source: Manual`) + `ENTITY_GROUP_CREATED` |
| `WordSelectionOverlay` (ADR-061 §4) | `document`, `viewer` | `actions.getPageWords` / `actions.addManualEntity` | ídem (los accesores no son eventos del bus) |
| `DocumentSearchBox` (ADR-061 §8) | `document` | `actions.findText` | (ninguno; consulta síncrona al Orchestrator) |
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
