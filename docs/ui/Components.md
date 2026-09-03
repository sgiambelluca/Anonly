<!-- CONTEXT: scope=componentes-ui | dependencias=ui/React_Client.md,ui/UX_Guidelines.md,ADR-001-Framework.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-054-Scroll-Independiente-Por-Panel.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-071-El-Genero-Se-Muestra-Solo-Donde-Se-Usa.md,adr/ADR-089-Buscar-No-Es-Agregar.md,adr/ADR-114-La-Seleccion-Del-Mouse-Es-De-Un-Renglon.md | audiencia=IA-implementador-ui | fase=4 (reconciliado en fase 10 por ADR-036: PasswordDialog/SettingsDialog/ConfirmDialog agregados §2.6–2.7/§8.9, zoom §5.2, mapeo §12; §2.6/§5.2/§5.5/§12 reescritos por ADR-037 —zoom con re-render real— y ADR-038 —SettingsDialog dispara reanalyze, no recreación del core—; §2.1/§2.5/§13.9 ajustados 2026-07-22 por el bug #7 del Escenario 1 E2E: gate de visibilidad por stage vs. vida del diálogo hijo abierto; §5.2/§5.4 en fase 11 por ADR-056 —requestRender con kind por panel, canvas que no se borra—; §3.3/§3.4/§7.1/§12 en fase 10.5 por ADR-058 —marca de reemplazo degradado— y ADR-059 —checkbox de leyenda—; §3.3 por ADR-062 —el canal `PREVIEW_UPDATED.degraded` del que sale esa marca, y las tres reglas de su consumo; el checkbox de leyenda entra en el Hito 10.5 y la marca queda para después—; §3.3/§3.4b/§12 en fase 10.6 por ADR-060 —PersonGenderSelect y marca de género sin determinar— y ADR-069 —§3.4b actualizado: el patch usa `PersonGenderChoice`, "sin determinar" viaja como `"neutral"` explícito—; §3.3/§3.4b/§8.3/§12 reescritos en fase 10.6 por ADR-071 —`PersonGenderSelect` pasa a ser `PersonGenderToggle`: visible solo en `placeholder`/`synthetic`, botón cíclico de tres estados con SVG propios, la marca de "sin determinar" fusionada con el estado neutro, y `Select` sin apertura controlada—; §3.4c/§5.4b/§5.4c/§12 en fase 10.7 por ADR-061 —agregado manual, hit-test de selección y buscador—; §1/§2.6 en fase 10.6 por ADR-070 —sección "Acerca de" con la atribución CC-BY dentro del SettingsDialog, y `thirdPartyCredits.ts` como módulo de datos—; post-Hito 10.10: §3.3 por ADR-086 —la marca de degradado se enciende cuando el texto queda más angosto que `DEGRADED_FONT_RATIO` de su ancho natural, criterio y valor nuevos—); §1/§2/§3/§4/§5/§7 reescritos en el rediseño post-10.9 por **ADR-087** —tres momentos en vez de cuatro paneles: `SideBySideViewer`/`ScrollSyncToggle` y los cuatro componentes de `rules/` se retiran, aparecen `LoadScreen`/`ScanScreen`/`ViewerModeToggle`/`DocumentModeSelect`/`TypeModeSelect`, y `ExportDialog` queda con un solo control—; §5.4c en fase 11 por **ADR-089** —la lupa afloja el último sub-token por prefijo y "Agregar como…" no, porque barre el documento entero—; §5.4b en fase 11 por **ADR-114** —la selección del arrastre se recorta a un renglón y el resultado de `addManualEntity` se muestra—; §3.3/§3.4d en fase 11 por **ADR-094** —`NeedsReviewBadge`: el detector sugiere lo que duda, apagado y marcado, y la fila sugerida no se atenúa— -->

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
│   ├── DocumentModeSelect.tsx     // ADR-087 §3, nivel documento (Rule scope "global")
│   ├── TypeModeSelect.tsx         // ADR-087 §3, nivel tipo (Rule scope "type")
│   ├── ModeSelectMenu.tsx         // ADR-087 §3, el menú que comparten los tres
│   ├── modeLevels.ts              // ADR-087 §3, lectura + planes de barrido
│   ├── applyMode.ts               // ADR-087 §3, ejecuta un plan y arma su undo
│   ├── entityTypeColors.ts        // acento de categoría del chip de tipo
│   ├── EntityTypeGroup.tsx
│   ├── EntityGroupItem.tsx
│   ├── ReplacementModeSelect.tsx  // nivel fila, sin cambios funcionales
│   ├── GroupContextMenu.tsx
│   ├── MergeDialog.tsx
│   └── SplitDialog.tsx
├── screens/                       // ADR-087 §1
│   ├── LoadScreen.tsx             // momento ①
│   ├── ScanScreen.tsx             // momento ②a
│   ├── ScanAnimation.tsx          // el documento con la lupa, de ②a
│   ├── scanPhrase.ts              // términos que rota la frase de ②a
│   └── scanProgress.ts            // qué progreso muestra ②a en cada momento
├── viewer/
│   ├── PdfViewer.tsx
│   ├── PageVirtualizer.tsx
│   ├── PageCanvas.tsx
│   ├── ViewerModeToggle.tsx       // ADR-087 §2 (reemplaza a SideBySideViewer)
│   └── ZoomControls.tsx
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
│   ├── Logo.tsx             // marca: documento con barra de censura
│   ├── Tooltip.tsx
│   ├── toast.ts             // ADR-087 §3.3: emisor imperativo, fuera de Zustand
│   ├── ToastHost.tsx
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
  - `stage === Idle`: **el `Toolbar` no se monta** — ese estado es el momento ① (`LoadScreen`, §2.9), pantalla completa (ADR-087 §1).
  - **Durante el momento ②a el `Toolbar` tampoco se monta** (`ScanScreen`, §2.10): esa pantalla trae su propio estado y su propio `Cancelar`. Las filas de abajo describen el `Toolbar` del momento ②b, que es donde existe.
  - `stage ∈ {Importing, Extracting, OCRing, Detecting, Grouping}`: `PipelineStatus` + `CancelButton`.
  - `stage ∈ {Ready, Done}`: `PipelineStatus` + `ExportButton`. **Sin `CancelButton`** (ADR-087 §7: `Ready` pasa a `HIDDEN_STAGES`). `CloseDocumentButton` pasa al menú de settings (§2.8). (`Done` no tenía fila — gap cerrado al resolver el bug #7 del Escenario 1 E2E: tras un export el documento sigue abierto y re-exportable.)
  - `stage === Rendering/Exporting`: `PipelineStatus` + `CancelButton`.
  - `stage === Failed`: banner de error + "Reintentar" o "Cerrar" (el "Cerrar" del banner, sin confirmación) + `CloseDocumentButton`.
  - `stage === Cancelled`: `PipelineStatus` + `CloseDocumentButton`.

  > **Reconciliación con §2.4 (2026-08-18, revisada por ADR-087 §7)**: la fila `{Ready, Done}` decía "(+ `CancelButton` si hay jobs remanentes)", un matiz inimplementable —no existe ningún campo de "jobs remanentes" en `pipeline.store`— que se resolvió mostrando el botón en `Ready` como en cualquier stage no terminal. **ADR-087 §7 corrige esa resolución en el otro sentido**: en `Ready` el pipeline ya terminó, no hay nada que cancelar, y el botón aparecía con peso de secundario junto al CTA primario mientras su `ConfirmDialog` advertía que *"los cambios no guardados se perderán"* — una amenaza imposible. `Ready` se agrega a `HIDDEN_STAGES` (§2.4). El caso real que el matiz de 2026-08-18 intentaba cubrir —trabajo del pipeline todavía corriendo— **sí existe ahora** y tiene su propio stage: el escaneo en segundo plano de `UX_Guidelines.md` §7.2, donde `stage` sigue siendo `Detecting`/`OCRing` y el botón se muestra por la regla general.

- **Acciones**: ninguna directa; delega en hijos.

### 2.2 `ImportButton`

- **Comportamiento**: `<input type="file" accept="application/pdf">` oculto + label estilizado. **Drag & drop funcional** sobre la zona de carga de `LoadScreen` (§2.9).

  > **No estaba implementado.** No hay ningún handler de drag & drop en el repo, y el botón del dropzone estaba `disabled` (`App.tsx:162`): la afordancia visualmente dominante de la primera pantalla era decorativa, y el único camino real era el botón chico de la esquina (ADR-087 Contexto §1, hallazgo 5). Con `LoadScreen` a pantalla completa, esa zona **es** el camino principal y tiene que funcionar.
- **Acción**: `actions.importDocument(file)`.
- **Atajo**: `Cmd/Ctrl+O`.

### 2.3 `PipelineStatus`

- **Estados**: muestra icono + texto según `stage` (ver `UX_Guidelines.md` §7.1).
- **Props**: ninguno (lee `pipeline.store`).
- **Sub-estados**:
  - `modelLoading != null`: **"Preparando el detector de nombres… 45 %"** — sin nombrar "NER", y aclarando que es solo la primera vez (`UX_Guidelines.md` §7.1).
  - `exportProgress != null`: "Exportando página 7 de 10…".
  - En otros casos: texto descriptivo + barra de progreso.
- **`Ready` no dibuja barra** (ADR-087, Contexto §1 hallazgo 4): hasta acá la barra se renderizaba en todos los stages no-`Idle`, así que en `Ready` quedaba en `width: 0%` con el texto "Listo" al lado — el elemento más grande de la toolbar mostrando "0 %" mientras el texto decía "terminado". Una barra sin progreso que reportar no se dibuja.
- **Ancho no fijo**: el `min-w-[220px]` anterior truncaba el texto a < 1100 px y a 900 px la barra quedaba tapada por el botón "Exportar".
- **Banner de análisis incompleto** (2026-08-28): en `Ready`/`Done` con `pipeline.failedJobs` no vacío, en vez del texto de estado se dibuja un `Banner` **warning** con "Recargar". Es un tercer estado, distinto de los dos que había: el pipeline **no** falló (no hay `PIPELINE_FAILED`, así que `pipelineErrorPresentation` no aplica) pero tampoco terminó bien. Antes de esto la toolbar decía "Listo" con un motor entero caído — ver `React_Client.md` §3.4 (`failedJobs`) y §8. El texto lo arma `incompleteAnalysisNotice.ts`, que no nombra motores ni códigos (ADR-087 §4).

### 2.4 `CancelButton`

- **Visible**: cuando `stage ∉ {Idle, **Ready**, Done, Failed, Cancelled}` (ADR-087 §7 agrega `Ready`). Sigue visible durante el **escaneo en segundo plano** posterior al pase temprano (`UX_Guidelines.md` §7.2), que es cuando de verdad sirve.
- **Acción**: abre `ConfirmDialog` → `actions.cancel()`.
- **Atajo**: `Cmd/Ctrl+.`.

### 2.5 `ExportButton`

- **Visible**: cuando `stage ∈ {Ready, Done}` (`Done` permite reabrir el diálogo con el resultado — "Descargar"/"Exportar otro", §7.2).
- **Vida del diálogo (bug #7 del Escenario 1 E2E, 2026-07-22)**: el gate de visibilidad aplica **solo al botón**; mientras `ExportDialog` esté abierto, el componente permanece montado aunque `stage` salga del set (`Exporting` durante el export, `Done` al finalizar) — `if (!visible && !open) return null`, nunca `if (!visible) return null` a secas. Sin esto, la transición `Ready → Exporting → Done` que el Core hace por spec (`Orchestrator.md` §8) desmonta el diálogo abierto con todo su estado justo antes de pintar el link de descarga.
- **Acción**: abre `ExportDialog`.
- **Atajo**: `Cmd/Ctrl+E` (activo solo cuando el botón es visible).

### 2.6 `SettingsButton` + `SettingsDialog` (ADR-036 §7, vocabulario por ADR-087 §4)

> **Los campos no nombran el pipeline.** "Idiomas de OCR" pasa a "Idiomas del documento", y las
> opciones pierden los códigos ISO ("Español (spa)" → "Español"), que son cómo se le pide el modelo
> al motor, no algo que el usuario tenga que elegir sabiendo.

> **El toggle de detección de nombres se retiró** (ADR-126). Existía como "Detectar nombres de
> personas y organizaciones", y sus dos posiciones no eran un gusto: una detecta nombres y la otra
> no. Apagarlo no cambiaba cómo se ve el documento, cambiaba **cuántos datos personales quedaban a
> la vista en el PDF exportado**, y en silencio — el árbol sin la categoría "Personas" es
> indistinguible de un documento que no tiene nombres. La detección de nombres está siempre activa
> y no tiene control. `nerEnabled` sobrevive **solo** como canal de override de los tests
> (`React_Client.md` §3.6).

- **Trigger**: icono de engranaje en el Toolbar (siempre visible; `UX_Guidelines.md` §2).
- **Stores**: `settings`, `document` (para saber si hay documento abierto).
- **Form** (`MVP.md` §2.3): idioma (`es` default), performance preset (`auto`/`low`/`high`), idiomas del documento. **Sin toggle de detección de nombres** (ADR-126).
- **Acción**: muta `settings.store` + `settings.persist()`. Si el cambio es `ocrLanguages` y hay documento abierto: `ConfirmDialog` "¿Reanalizar el documento con la nueva configuración? Tus ediciones se conservan." → `actions.reanalyze(patch)` (ADR-038 §7, `React_Client.md` §3.7 — **no** recrea el core). Si es `performancePreset` con documento abierto: se persiste y aplica al próximo documento, sin diálogo de confirmación (ADR-038 §7 Q3).
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

- **Ubicación** (ADR-087 §1): **dentro del menú de settings**, no como botón suelto de la `Toolbar`. En `Ready` la toolbar tenía cuatro controles —"Exportar", "Cancelar", "Cerrar documento", ⚙— con los dos destructivos flanqueando el CTA primario. "Cerrar documento" es infrecuente y destructivo: no compite por la barra.
- **Visible**: hay documento activo y `stage ∈ {Ready, Done, Failed, Cancelled}` — o sea, con el pipeline detenido. Durante una corrida el control es `CancelButton` (§2.4), no este: cerrar a mitad de pipeline es "cancelar + liberar" (`Orchestrator.md` §13 caso 11) y dos botones para lo mismo solo multiplican caminos.
- **Acción**: abre `ConfirmDialog` ("¿Cerrar el documento? Se perderán las ediciones y reglas de esta sesión.") → `actions.closeDocument()`.
- **Vida del diálogo**: aplica la regla 9 de §13 (`if (!visible && !open) return null`) — un `PIPELINE_STAGE_CHANGED` por debajo no puede desmontar el `ConfirmDialog` abierto.
- **Atajo**: ninguno en MVP (`Cmd/Ctrl+W` lo captura el navegador).
- **ARIA**: `aria-label="Cerrar documento"`.
- **Por qué existe** (ADR-051): sin este control, un documento que llega a `Ready` solo se puede cerrar recargando la pestaña, y como `validateImportInput` exige cerrar antes de importar otro (`Orchestrator.md` §13 caso 12), tampoco se podía abrir un segundo PDF. **Ese sigue siendo el único camino para abrir otro PDF** — `ImportButton` solo se monta en `Idle` (§2.1), así que "cerrar" es el paso obligatorio antes de importar. ADR-087 no lo resuelve; queda anotado como deuda de UX. Bloqueaba además el Escenario 7 E2E y el gate `test:leak` de Hito 11.
- **No confundir con** el "Cerrar documento" del banner de error de `PipelineStatus` (§2.3): ese cierra **sin** confirmación, porque en `Failed` no hay ediciones que perder. Los dos conviven a propósito.

---

### 2.9 `LoadScreen` (ADR-087 §1, momento ①)

- **Stores**: ninguno (se monta cuando `document.store.id === null`).
- **Render**: pantalla completa. Logo, una frase de qué hace la herramienta, la **zona de carga
  funcional** (drop + botón, los dos operativos) y tres features breves.
- **No monta** el árbol de entidades ni ninguna barra lateral: no hay nada que mostrar todavía.
- **Monta `SettingsButton`** en la esquina superior derecha (ADR-125 §1). Es lo **único** que
  vuelve de la `Toolbar` a esta pantalla: el estado del pipeline, el progreso, el export y el
  cierre de documento siguen sin tener nada que decir sin documento, y esa parte de ADR-087 §1
  no se toca. Existe porque `SettingsButton` viajaba dentro de la `Toolbar` que ADR-087 sacó de
  acá —sin mencionarlo ni una vez—, y con eso la única forma de llegar a Configuración pasó a
  ser cargar un PDF primero, que es lo contrario de lo que hace falta para elegir con qué
  analizarlo.
- **Acción**: `actions.importDocument(file)`, por drop o por el botón.

### 2.10 `ScanScreen` (ADR-087 §1/§6, momento ②a)

- **Stores**: `pipeline` (stage y progreso), `entities` (el contador y los grupos que van
  apareciendo), `document` (nombre y `pageCount`).
- **Se monta sin `Toolbar`** (`App.tsx`), igual que `LoadScreen`: trae estado, progreso y
  `Cancelar` propios. Montar la toolbar arriba dejaba **dos barras de progreso del mismo pipeline y
  dos botones "Cancelar"** en pantalla al mismo tiempo — verificado en el browser. El logo de
  continuidad entre ① y ② lo pone esta pantalla.
- **Render**: `ScanAnimation`, nombre del archivo, la frase que rota tipos de dato, estado en
  lenguaje llano, progreso `current`/`total` real de la etapa vigente y `Cancelar`. Ver
  `UX_Guidelines.md` §7.3.

  > **Sin la lista de entidades encontradas**, que la primera versión mostraba apareciendo en vivo
  > acá. Se retira porque **se ven mejor donde importan**: en el árbol del panel de trabajo llegan
  > con su tipo, su contador y sus controles, y el usuario puede actuar sobre ellas. Repetirlas
  > antes, en una lista que dura tres segundos y de la que no se puede hacer nada, gastaba la
  > primera impresión del dato en un lugar donde no sirve. Lo que sostiene la paciencia pasa a ser
  > el movimiento.
- **Sin skeleton del documento**: no promete un layout que todavía no existe.
- **Salida** (`UX_Guidelines.md` §7.2): pasa a ②b con la primera de — `Detecting` ≥
  `SCAN_ADVANCE_PAGE_RATIO` (0.20) de `document.store.pageCount`, con `modelLoading === null`, o
  `SCAN_ADVANCE_MAX_MS` (6000 ms) desde el import — y **nunca** antes de `SCAN_ADVANCE_MIN_MS`
  (1200 ms).

  > **El denominador es `pageCount`, no `pipeline.store.total`**: `total` se reasigna por etapa, y
  > durante la descarga del modelo NER vale 1 con el stage ya en `Detecting` — razón 1.0, umbral
  > satisfecho al instante, usuario soltado apenas termina el OCR. Medido en el browser.

  > Piso y techo son **globales** desde el import, no relativos a `Detecting`: la descarga del
  > modelo NER es tiempo muerto sin entidades, y un techo medido desde `Detecting` dejaría al
  > usuario sin cota. El umbral de páginas sí se mide sobre `Detecting`, que es la etapa larga y la
  > que produce la mayoría de las entidades (`orchestrator.ts:267`).

- **Tras el pase, el escaneo sigue** en segundo plano, con el estado visible en `PipelineStatus`
  (§2.3) y `CancelButton` (§2.4) activos.

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
  - **reemplazo degradado** (ADR-058 §7, canal por ADR-062): alguna ocurrencia del grupo recibió `AnnotationKind.Degraded` — el texto de reemplazo quedó más angosto que `DEGRADED_FONT_RATIO` de su ancho natural (ADR-086 §1) y esos píxeles quedaron comprometidos. Es una marca **accionable**, no informativa: existe porque la palanca para arreglarlo ya existía y era invisible. Al abrirla, ofrece las tres salidas —editar el `replacementValue` a mano, cambiar el modo a `redact` (que no tiene problema de espacio) o deshabilitar el grupo—. **No** aparece cada vez que el repintado de línea no se activó: solo bajo el umbral, para que la señal signifique algo.

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
- **Opciones**: `placeholder` (default), `mask`, `synthetic`, `redact` — con las **etiquetas de
  `UX_Guidelines.md` §3.5** (ADR-087 §4): "Etiquetar", "Ocultar parcialmente", "Reemplazar por dato
  falso", "Tapar con negro". El enum **no cambia** (ADR-012 intacto); cambian solo las etiquetas de
  `replacementModeOptions.ts`.
- **Cada opción trae un ejemplo construido con el grupo real de esa fila**, no un valor genérico: la
  pregunta del usuario es qué le pasa *a su dato*.

  > **El único valor exacto que la UI puede mostrar es el del modo vigente** (`replacementValue`, ya
  > resuelto por Grouping). Los otros tres se describen de forma esquemática y **no se inventan**: el
  > token de `placeholder` sale de la escalera de ADR-057 y del género de ADR-060, el formato de
  > `mask` de `MASK_FORMAT_BY_TYPE` —que vive en `grouping-engine`, un motor que la UI no puede
  > importar (P-1)—, y el de `synthetic` del sintetizador sembrado con el `id` (ADR-072 §1).
  > Reimplementarlos violaría `React_Client.md` U-3, y un ejemplo *casi* correcto es peor que uno
  > declaradamente esquemático: la primera versión mostraba `[PERSONA 01]` para **todos** los tipos,
  > así que un DNI previsualizaba como si fuera una persona.
- **Acción**: crea/actualiza una **`Rule` de scope `group`** para ese grupo (ADR-087 §3.1a). **Esto cambia** respecto de la implementación vigente, que emitía `GROUP_UPDATE_REQUESTED` con `patch.replacementMode`.

  > **Por qué cambia**: `resolveMode` chequea las reglas **antes** que `group.replacementMode`, y `grouping.engine.ts:1150-1151` lo hace literal — asigna lo que el usuario eligió y una línea después lo pisa con el resultado de `resolveMode`. Con una regla de tipo vigente, el selector de la fila **es inerte**. Hoy casi no se nota porque el panel de Reglas no se usa; con §3.9/§3.10 creando reglas de rutina, pasaría a ser el comportamiento normal.

- **Undo** (§3.11): toast **solo si `group.replacementValueUserSet === true`** — cambiar el modo destruye el texto escrito a mano sin vuelta (`grouping.engine.ts:1151-1160`). En el resto de los casos no lleva toast: es la acción más frecuente de la app y es autoevidente y autorreversible con el mismo control.
- **Implementación**: Radix `Select`, presentación **ghost** (ADR-087 §3.1): sin borde ni fondo
  hasta el hover, mostrando en gris el modo vigente. Cuando existe una `Rule` de scope `group` para
  ese grupo —o sea, cuando la fila tiene decisión propia y no va a seguir a la cabecera del tipo—
  gana **un punto y peso de texto**, no un borde (ver la nota de §3.10). Ese lookup en `rules.store`
  es todo lo que hace falta: sin flag nuevo en `EntityGroup` y sin reimplementar `resolveMode`.
- **Etiqueta corta en el disparador, larga en el menú y en el nombre accesible**: el disparador de
  la fila mide 11 rem y "Ocultar parcialmente" se cortaba en "Ocultar parcialme…". El menú —donde
  el usuario lee qué hace cada modo— muestra siempre la forma larga.
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

### 3.4d `NeedsReviewBadge` (ADR-094 §4)

Marca los grupos que **el detector sugirió sin estar seguro**: nacen con `enabled: false` y `needsReview: true`, así que están a la vista y **no tapan nada** hasta que el usuario decida.

- **Props**: `group: EntityGroup`. No renderiza nada si `group.needsReview` es `false`.
- **Forma**: un badge con icono + `Tooltip`, mismo patrón que `DegradedBadge` (§3.3). **Sin diálogo**: no hay nada que explicar más allá de una frase y la acción ya existe — la casilla de la fila.
- **Dónde**: en `EntityGroupItem`, junto a las otras marcas.

**El copy no lleva jerga, y no muestra el número.** El usuario no tiene que ver "0,59" ni saber qué es un umbral de confianza: tiene que saber que **esa fila merece una mirada más que las otras**. Mismo criterio que §3.3 ya fija para el aviso de degradado.

- Tooltip: *"El detector no está seguro de que esto sea un dato personal. Revisalo."*
- `aria-label` del badge: `Revisar ${canonicalValue}: el detector no está seguro de que sea un dato personal`.

**La fila sugerida NO se atenúa.** `EntityGroupItem` aplica `opacity-50` a los grupos deshabilitados, y un grupo sugerido está deshabilitado — pero atenuarlo lo haría ver como uno que el usuario ya descartó, que es exactamente lo contrario de lo que pide atención. La atenuación pasa a aplicar solo cuando `!enabled && !needsReview`.

**El `aria-label` de la fila lo dice también** (`role="treeitem"`, §3.3): un usuario de lector de pantalla no pasa el mouse por encima de un tooltip. Se agrega ", a revisar" a la enumeración que ya arma la fila.

**La marca se apaga sola con la decisión del usuario** (ADR-094 §4): tildar o destildar la casilla limpia `needsReview` en el motor, en los dos sentidos — habilitar es aceptar la sugerencia, deshabilitar es rechazarla. La UI no hace nada especial para eso: recibe el `ENTITY_GROUP_UPDATED` y re-renderiza.

### 3.5 `GroupContextMenu`

- **Trigger**: botón `[⋯]` en `EntityGroupItem`.
- **Opciones**:
  - "Fusionar con…" → `MergeDialog`.
  - "Dividir…" → `SplitDialog`.
  - **"Ver ocurrencias"** (ADR-084 §2) → escribe `group.canonicalValue` en `viewer.store.searchQuery`. El `DocumentSearchBox` (§5.4c) reacciona solo: busca, cuenta y deja anterior/siguiente listos para recorrer el documento resaltando cada aparición. **No se construye un popover propio**: el buscador ya scrollea, resalta y navega — el popover de la redacción anterior (que además pedía un `value` por ocurrencia, que en ese momento `OccurrenceRef` no tenía — ADR-104 se lo agregó después, por otro motivo) habría sido una segunda UI de navegación, peor que la que existe.
    - **El contador del buscador puede no coincidir con el `(N)` del grupo**, y está bien (ADR-084 §3): `findText` busca el literal, `members` son las ocurrencias agrupadas. Un grupo con aliases tiene members que la búsqueda del canónico no encuentra; y la búsqueda puede encontrar apariciones que el detector no agrupó — que es justamente el recall que ADR-061 cubre, con el "Agregar como…" de cada resultado a mano.
  - **"Cambiar categoría"** (ADR-082 §6) → `ChangeTypeDialog` (§3.8): `Select` con todos los `EntityType`, preseleccionado en el actual → `actions.updateGroup(groupId, { type })`. Sin `ConfirmDialog`: es reversible volviendo a elegir el tipo anterior.
  - **"Restaurar valor calculado"** (ADR-078 §4) → **solo** si `group.replacementValueUserSet`; despacha `actions.updateGroup(groupId, { replacementMode: <el mismo modo> })`, que recalcula el valor y apaga el flag sin API nueva.
  - "Editar valor canónico" → input inline.
  - "Eliminar grupo" → `ConfirmDialog` → `actions.updateGroup(groupId, { enabled: false })` (no se elimina, se deshabilita; en MVP no se elimina completamente).

> **Accesibilidad**: el menú es un disclosure hecho a mano (trigger con `aria-expanded` + panel `role="group"` con botones, cierre por click-fuera/Escape/selección), sin `@radix-ui/react-dropdown-menu` — agregar esa dependencia requiere ADR (P-9/R-12). Los items se recorren con **Tab**, no con flechas.
>
> **No usa `role="menu"`/`role="menuitem"` ni `aria-haspopup`**, y es deliberado (2026-08-20). Ese rol es un contrato con el lector de pantalla: promete navegación por flechas, Home/End y foco gestionado con un solo tab stop, y nada de eso está implementado. Anunciarlo igual deja al usuario de teclado apretando flechas contra un panel que no responde — peor que no anunciar nada, porque sin el rol son botones en un grupo etiquetado y se comportan como el lector espera. `aria-haspopup="true"` sale por lo mismo: en WAI-ARIA 1.1+ es **sinónimo de `menu`**, así que reintroducía la promesa por la puerta de atrás. Si algún día entra Radix, trae el rol **y** el manejo de foco juntos, que es la única forma correcta de tener el primero.
>
> **Los roles de este menú son API de test.** Tres escenarios E2E localizan sus items por rol (`scenario-9`, `scenario-10`), y `pnpm test` **no** corre la suite E2E — así que cambiar un rol acá pasa los cuatro gates del subset pre-PR y rompe en CI. Pasó al retirar `role="menuitem"`. Quien toque estos roles corre `pnpm test:e2e` en el mismo cambio (requiere `pnpm assets:mirror` previo, ver `tests/e2e/README.md`).

### 3.8 `ChangeTypeDialog` (ADR-082 §6)

- **Props**: `groupId`, `currentType`, `canonicalValue`.
- **Acción**: `actions.updateGroup(groupId, { type })`. Un tipo igual al vigente es no-op (el motor no emite nada, ADR-082 §1) y el diálogo además se ahorra el viaje.
- **Por qué existe**: el tipo no es una etiqueta suelta — gobierna el token del documento anonimizado, su numeración por tipo, qué regla de scope `type` aplica y de qué pool sortea el sintetizador. Un tipo equivocado produce un documento que **afirma algo falso** sobre el dato que ocultó.

### 3.6 `MergeDialog`

- **Props**: `sourceGroupId`.
- **Comportamiento**: autocomplete para elegir `targetGroupId` (filtrado por mismo `EntityType`).
  **Varios destinos a la vez** (`UX_Guidelines.md` §3.2, "2+ grupos del mismo tipo"): el botón
  **"+ Agregar otro grupo"** suma una fila de destino, y cada fila ofrece solo los grupos que
  ninguna otra tomó. La **primera fila es el grupo que sobrevive** —conserva su `id`, su modo y su
  identidad— y por eso no se puede quitar; las demás tienen su botón de quitar.
- **Acción**: `actions.mergeGroups(sourceGroupId, targetGroupId)`, una vez por cada paso de
  `mergePlan(sourceGroupId, targetGroupIds)`. **El contrato no cambia**: `GROUP_MERGE_REQUESTED`
  sigue siendo 1→1 (`Contracts.md`) y la UI emite N-1 requests contra el mismo destino. Es seguro
  en fila porque `applyGroupMerge` corre síncrono (no hay `await` en su cuerpo) y porque el grupo
  que sobrevive es el `target`, que conserva su `id` — el destino de los pasos siguientes existe
  todavía. Cada paso se queda con `min(index)`, así que el resultado conserva el menor de todos.
- **Feedback**: toast "Grupos fusionados. Índice conservado: 01."

### 3.7 `SplitDialog`

- **Props**: `groupId`.
- **Comportamiento**: lista de `members` con checkbox. Muestra bbox miniatura por ocurrencia.
- **Acción**: `actions.splitGroup(groupId, selectedOccurrenceIds)`.
- **Feedback**: toast "Grupo dividido. Nuevo grupo: <type> <NN>."

---

### 3.9 `DocumentModeSelect` (ADR-087 §3, nivel documento)

- **Stores**: `rules` (la `Rule` de scope `global` vigente, y el conteo de reglas de `type`/`group`
  para el estado de precaución).
- **Ubicación**: franja propia **arriba del árbol y fuera** de él, no como fila del árbol.
- **Render**: label "Todo el documento" + `Select` con las opciones de §3.4.
- **Tratamiento visual** (ADR-087 §3.1): **borde sólido + label explícito**. Es el control de mayor
  alcance, así que es el que más deliberado tiene que verse accionar. Estar fuera del árbol es
  parte del tratamiento: no puede confundirse con una fila.
- **Estado de precaución** (ADR-087 §3.3a): **neutro por defecto**; con alguna `Rule` de scope
  `type` o `group` vigente, gana **acento ámbar + resumen** (`⚠ 5 categorías y 12 entidades con
  ajustes propios`). El color aparece cuando significa algo, y el resumen entera del riesgo antes
  de abrir el menú. **Nunca señala solo con color**: ícono + texto además del acento.
  - Usa **`--color-warning-strong`** (§10), **no** `--color-warning`, que no llega al contraste
    mínimo de elementos no textuales.
  - **Ámbar y no rojo**: la acción es reversible y no toca el documento, solo los ajustes.
- **Acción** (ADR-087 §3.1b regla 3): **borra las `Rule` de scope `type` y `group`** y
  crea/actualiza la de scope `global`. Barre absolutamente todo — es lo que "todo el documento"
  significa.
- **Confirmación**: solo si existe alguna `Rule` de scope `type` o `group`; el diálogo **nombra lo
  que va a romper**, con los conteos. Sin ajustes previos aplica directo.
- **Undo** (§3.11): toast de 5 s, **con snapshot** de las reglas borradas.

### 3.10 `TypeModeSelect` (ADR-087 §3, nivel tipo)

- **Props**: `type`, `groups` (los del tipo, para computar el estado mixto).
- **Stores**: `rules` (la `Rule` de scope `type` vigente para ese `EntityType`, y las de scope
  `group` de sus grupos).
- **Ubicación**: en la cabecera de `EntityTypeGroup` (§3.2).
- **Tratamiento visual** (ADR-087 §3.1): **chip con relleno gris** (`bg-tertiary`) y una barra de
  acento a la izquierda con el color de categoría del tipo (§9). Se lee como parte del encabezado,
  no de las filas que agrupa.

  > **Lo que separa los tres niveles es el relleno, no el borde.** Una primera implementación usó
  > `ring-1 ring-border` acá y también en la fila con decisión propia: verificado en el browser, los
  > dos eran indistinguibles — exactamente la confusión de alcance que estos tratamientos existen
  > para evitar. Quedan tres rellenos distintos: **blanco con borde** (documento), **gris**
  > (tipo), **transparente** (fila).
- **Estado mixto**: cuando los grupos del tipo **no comparten** `replacementMode`, muestra
  `Varios ▾`. El menú es el normal — con la acción de abajo, cualquier opción uniforma el tipo, así
  que **no hay un ítem especial de "aplicar a todos"**. `Varios` es un estado de display puro.

  > **"Varios" y no "Personalizado"**: `ReplacementModeSelect` (§3.4) **ya usa "Personalizado"**
  > para otra cosa — el `replacementValue` editado a mano (ADR-078 §1). Reusarlo acá pondría dos
  > significados en la misma palabra, en la misma columna, a dos filas de distancia. Además
  > "Personalizado" describe un *origen* y lo que la cabecera comunica es un *estado*.

- **Acción** (ADR-087 §3.1b regla 2): **borra las `Rule` de scope `group` de los grupos de ese
  tipo** y crea/actualiza la de scope `type`.
- **Confirmación**: solo si algún grupo del tipo tiene `Rule` de scope `group`.
- **Undo** (§3.11): toast de 5 s, **con snapshot** de las reglas borradas.

### 3.11 Undo de los cambios de modo (ADR-087 §3.3)

**La fricción escala con lo que hay en juego.** Ningún nivel confirma cuando no hay nada que romper:

| Nivel | Confirmación | Toast "Deshacer" (5 s) |
|---|---|---|
| `ReplacementModeSelect` (§3.4) | nunca | solo si `replacementValueUserSet === true` |
| `TypeModeSelect` (§3.10) | solo si el tipo tiene reglas de grupo | siempre |
| `DocumentModeSelect` (§3.9) | solo si hay reglas de tipo o de grupo | siempre |

- **El toast lleva snapshot, no un id**: deshacer un barrido tiene que **recrear las `Rule` que
  borró** (§3.9/§3.10), no solo eliminar la que creó. Sigue sin necesitar infraestructura de undo
  general — es guardar la lista y recrearla — pero el `Toast` (§8.6) carga esa lista.
- **Toast y no `ConfirmDialog` como mecanismo principal**: una confirmación por cada cambio de modo
  se vuelve ruido que se aprende a saltear. La confirmación queda para los dos barridos, y solo
  cuando barren algo.
- **Por qué la fila normalmente no lleva toast**: es la acción más frecuente de la app, y es
  autoevidente y autorreversible con el mismo control. Un toast por cada una arrastra consigo la
  credibilidad de los toasts de los otros dos niveles.

---

## 4. Componentes de Reglas — **retirados** (ADR-087 §3)

`RulesPanel`, `RuleItem`, `RuleCreatorDialog` y `RuleEditorDialog` **se retiran del catálogo y del
layout**. El panel ocupaba la mitad de la barra lateral (`sectionHeights: [423, 422]`) y con cero
reglas —el caso normal— mostraba la frase "Aún no hay reglas" en 422 px de la región crítica.

Su función completa la cubren dos componentes nuevos en `entities/` (§3.9, §3.10) más el selector
de fila que ya existía (§3.4), ahora escribiendo la regla de scope `group`:

| Retirado | Lo reemplaza |
|---|---|
| `RulesPanel` (sección "Global") | `DocumentModeSelect` (§3.9) |
| `RulesPanel` (sección "Por tipo") | `TypeModeSelect` (§3.10) |
| `RulesPanel` (sección "Por grupo") | `ReplacementModeSelect` (§3.4), que **pasa a escribir esa misma regla** (§3.1a de ADR-087) |
| `RuleCreatorDialog` / `RuleEditorDialog` | — (no hay modal: el control *es* el selector) |
| `RuleItem` | — (no hay lista de reglas; el estado mixto se lee en la cabecera, §3.10) |

**`rules.store` se conserva** (`React_Client.md` §3.3), y pasa a usarse **más** que antes: los tres
selectores del árbol crean, editan y borran `Rule` por las mismas acciones de siempre, y el estado
visual de cada nivel (borde de fila, `Varios`, acento de precaución) se **deriva** de qué reglas
existen. Lo que se retira es la superficie de UI, no el modelo.

---

## 5. Componentes del Visor

### 5.1 `ViewerModeToggle` (ADR-087 §2, reemplaza a `SideBySideViewer`)

- **Stores**: `viewer` (modo activo), `pipeline` (para el gate de `Ready`).
- **Render**: toggle de dos posiciones `( Original | Anonimizado )` sobre un **único** `PdfViewer`.
- **Props**: ninguno (todo vía store).
- **Gate duro**: la posición "Anonimizado" está **deshabilitada mientras `stage !== Ready`**, con
  el texto *"Disponible cuando termine el análisis"*. Antes de `Ready` los `replacements` no
  existen y el render anonimizado es **idéntico al original** (`core/Render_Engine.md` §13 caso 1);
  mostrarlo bajo ese rótulo es el defecto de seguridad que ADR-087 Contexto §3 documenta.
- **Continuidad**: conmutar **no** mueve página, scroll ni zoom (`UX_Guidelines.md` §5.5). Un salto
  de posición rompe la comparación por alternancia, que es lo que reemplaza al lado a lado.
- **Atajo**: `Cmd/Ctrl+D`.

> **Retirados junto con el lado a lado**: `SideBySideViewer`, `ScrollSyncToggle` (§5.6) y
> `scrollSyncController`. Con un solo panel no hay dos scrolls que sincronizar. `settings.
> scrollSyncEnabled` se retira de `settings.store`; `viewer.visibleRange`/`currentPageIndex` dejan
> de ser por `kind`.
>
> **ADR-054 y ADR-056 no quedan invalidados**: existían porque dos paneles independientes pedían
> renders que se pisaban. Con un panel el problema **deja de existir** en vez de resolverse.
> `RENDER_REQUESTED.kind` sigue requerido y sin cambios — ahora lo determina el toggle.

### 5.2 `PdfViewer`

- **Props**: **ninguno** (ADR-087 §2). El `kind` sale de `viewer.store.mode` — hay un solo `PdfViewer` y lo que muestra lo decide el `ViewerModeToggle` (§5.1).
- **Stores**: `viewer`, `entities` (para highlights en `original`), `document`, `pipeline`.
- **Comportamiento**: usa `PageVirtualizer` para renderizar solo visibles. Escucha `PREVIEW_UPDATED` via `viewer.previewByPage[kind]` (sigue siendo **por `kind`**, `React_Client.md` §3.5: las dos vistas tienen imágenes distintas de la misma página, y conmutar el toggle pinta la cacheada sin esperar un render nuevo) y pasa el `blobUrl` al `PageCanvas` correspondiente.
- **La barra con el buscador solo se monta en `original`**: el rótulo del lado lo dice el toggle, así que repetir "Documento original" al lado de un toggle que ya dice "Original" sería decir lo mismo dos veces en la misma línea.
- **Eventos** (reconciliados por ADR-036 §5, reescrito por ADR-037, `kind` agregado por ADR-056 §1/§2):
  - Cambio de `visibleRange` → `actions.requestRender(pageIndices, kind)` — **con el `kind` de este panel**: el motor renderiza solo ese lado. Antes se emitía sin `kind` y Render producía original y anonimizado, lo que con scroll independiente (ADR-054) hacía que scrollear este panel refrescara el otro.
  - Cambio de `zoom` → escala **CSS/canvas** del bitmap ya renderizado de inmediato (feedback durante el gesto) y, tras 150 ms sin nuevos ticks, `actions.requestRender(visibleRange, kind, "preview", previewScale × zoom)` para un **re-render real** (ADR-037 §1/§5, supersede ADR-036 §6). El `PREVIEW_UPDATED` resultante reemplaza el bitmap CSS transitorio por el nítido.
  - Primer render al observar `Ready` (`readyRenderTrigger.ts`) → también con el `kind` de este panel.
  - **El `kind` sale de la posición del `ViewerModeToggle`** (§5.1, ADR-087 §2), nunca inferido de otra cosa. `RENDER_REQUESTED.kind` sigue requerido y con la misma semántica de ADR-056 §2: se renderiza exactamente el lado que se está mirando. Antes de ADR-087 el `kind` era una prop fija por panel y la regla era "nunca derivarlo de `settings.scrollSyncEnabled`"; con un solo panel esa fuente de verdad alternativa ya no existe.

### 5.3 `PageVirtualizer`

- **Props**: `pageCount`, `renderItem: (index) => ReactNode`, `visibleRange`, `pageSize`, `pageWidth`, `onVisibleRangeChange`, `onCurrentPageIndexChange`, `scrollRequest?`. **Sin `scrollToPageIndex`** (ADR-054 §6) y **sin `scrollSync` ni `kind`** (ADR-087 §2): con un solo panel no hay seguidor ni sincronización que instanciar, y `kind` solo servía para identificarse ante el controller.
  - Se retira con `scrollSync` el `ResizeObserver` que detectaba el panel volviéndose visible (alto 0 → alto > 0) para realinearlo: sin panel oculto no hay transición que observar.
  - `pageWidth` (post-Hito 10.7, hallazgo post-`APPROVED` 2026-08-15): el ancho de página en CSS px, mismo `pageWidth` que `PdfViewer` ya calcula. El contenedor con scroll lo usa como `width: max(pageWidth, 100%)` — no el 100% implícito de un bloque — para que a zoom alto, cuando `pageWidth` supera el ancho del panel, el contenedor **crezca** en vez de dejar que `PagePhantom` (`inset-x-0`) centre por flex un `renderItem` más ancho que él: ese centrado desborda por igual a los dos lados, pero un navegador en LTR solo cuenta el desborde a la **derecha** como `scrollWidth` — el borde izquierdo de la página queda a `scrollLeft` negativo, inalcanzable. Con el contenedor ya del ancho correcto, todo el desborde cae a la derecha y se alcanza scrolleando.
  - `onVisibleRangeChange`: reporta al rango que detecta el `IntersectionObserver` (rango de **montaje** únicamente, ADR-054 §5) — cierra el loop de "usa `IntersectionObserver` para detectar visibilidad" hacia el estado controlado por `PdfViewer`.
  - `onCurrentPageIndexChange(pageIndex)`: página actual derivada por geometría de scroll (ADR-054 §5), reportada solo cuando cambia.
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
- **La selección se recorta a UN renglón** (ADR-114 §1): de las palabras que el rectángulo tocó se conserva la corrida con más **área seleccionada**, y una corrida se corta cuando aparece una palabra no señalada o cuando la `x` **retrocede** (el retorno de carro). El renglón no se re-deriva acá: `Page.words` ya viene agrupado por renglón (ADR-110/ADR-113), y las dos condiciones hacen falta porque dos renglones seguidos de la misma columna son contiguos en ese array. **El desempate es por área, no por cantidad de palabras**: dos renglones de cuatro palabras empatan, y el que el usuario cubrió es el que vale.
  - **Por qué**: el valor se arma con `join(" ")` y `findLiteral` exige sub-tokens consecutivos de una misma línea (ADR-089 §1), así que un valor de dos renglones **no puede matchear nunca**. Medido sobre el sello de un fallo escaneado, donde los renglones están a 4–6 pt: con el rectángulo justo la frase se encuentra en 18/18 páginas; con 4 pt de holgura, en 0/18.
- **Acción**: `actions.addManualEntity({ value, entityType })` con el texto de las palabras señaladas. **Se espera el resultado** y se pasa por `manualEntityFeedback` —el mismo helper de §3.4c—: con `not-found` el popover queda abierto con "No se encontró ese valor en el documento"; con `added` se cierra (ADR-114 §2). Antes era una promesa suelta, así que encontrar 18 apariciones y no encontrar ninguna se veían igual.

### 5.4c `DocumentSearchBox` (ADR-061 §8)

- **Ubicación**: junto al encabezado "PDF ORIGINAL", con icono de lupa (punto 4 de `Cambios para hacer.txt`).
- **La consulta vive en `viewer.store.searchQuery`** (ADR-084 §1), no en el estado local del componente: "Ver ocurrencias" del panel de entidades (§3.5) la escribe desde el otro extremo del árbol. **No es por panel** —a diferencia de `currentPageIndex`/`visibleRange` desde ADR-054 §1— porque el buscador existe una sola vez, sobre el `original`. El resto de su estado (matches, `activeIndex`, el tipo del "Agregar como…") **sigue siendo local**: es trabajo interno suyo.
- **Acción**: `actions.findText(query)` → `TextMatch[]` con bbox por coincidencia (el adaptador resuelve el documento activo por su cuenta, igual que `getPageWords`/`getPageSize`). Consulta **sincrónica** y de solo lectura: buscar no crea grupos ni modifica la sesión (errata de ADR-061 §8).
- **El debounce es de este componente**: `findText` es sincrónica y recorre todas las palabras del documento en el main thread, así que una llamada por tecla se nota en documentos largos. El Core no amortigua —es una función de consulta, sin estado ni cache (`Regex_Engine.md` §12)—, así que la caja de búsqueda debe hacerlo, mismo criterio que el re-render del zoom (§5.5). Los resultados vienen en orden documental, así que "anterior/siguiente" navega el array tal cual, sin re-ordenar.
- **Render**: contador de resultados, navegación anterior/siguiente con scroll a la página, y resaltado del match activo sobre el canvas (reusa el mismo overlay de §5.4b).
- **Tercera vía de agregado**: cada resultado ofrece "agregar como entidad", que abre el selector de tipo y llama a `addManualEntity`. Es la misma búsqueda literal que alimenta el agregado manual (ADR-061 §8), con **una** diferencia deliberada desde ADR-089 §2: la lupa acepta que el último sub-token de la consulta sea un **prefijo** (`Ana` resalta `Anabella`), y `addManualEntity` **no**. **Agrega todas las apariciones del valor, no solo el resultado clickeado** — `addManualEntity` recorre el documento entero, que es el comportamiento correcto para una entidad manual; el copy debe decirlo para que no se lea como que anonimiza solo esa coincidencia. Esas dos frases juntas son la razón de la asimetría: con prefijo en las dos, agregar `Ana` taparía cada `Anabella` del expediente. **Consecuencia visible**: un resultado resaltado por prefijo puede no ser agregable con ese mismo texto — el usuario tiene que agregar la palabra completa.

### 5.5 `ZoomControls`

- **Botones**: `+`, `-`, `Reset`.
- **Atajos**: `Cmd/Ctrl++`, `Cmd/Ctrl+-`, `Cmd/Ctrl+0`.
- **Acción**: `viewer.setZoom(newZoom)` (aplica el escalado CSS inmediato vía `PdfViewer` §5.2); el re-render real se dispara con debounce, no en cada click/atajo individual (`ZOOM_RERENDER_DEBOUNCE_MS = 150 ms`, ADR-037 §5).

### 5.6 `ScrollSyncToggle` — **retirado** (ADR-087 §2)

Control de la sincronización de scroll entre los dos paneles del lado a lado. Sin lado a lado no
hay nada que sincronizar: se retira junto con `SideBySideViewer` y `scrollSyncController`.

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
- **`ambiguous_canonical`: se elige la escritura** (ADR-106). El diálogo ofrece los `value` de los candidatos empatados como radios, con el `canonicalValue` vigente preseleccionado, y aplicar emite `actions.updateGroup(groupId, { canonicalValue })` + `actions.resolveConflict(conflictId)`. La pregunta es la que el usuario tiene: *¿cuál de estas dos escrituras usamos?* **Revisa ADR-083 §6**, que metía este caso junto a `low_confidence` bajo "no hay elección": era cierto sobre el eje del **tipo** —todos los candidatos comparten tipo— pero no comparten **valor**, y sobre ese eje la elección existe y está bien definida. Sin contrato nuevo: `canonicalValue` ya estaba en `GroupUpdateRequested.patch` y los `value` ya venían en el conflicto.
- **Cuando no hay elección**: `low_confidence` no ofrece radios y el botón dice "Descartar" — con **un** candidato por debajo del umbral no hay nada entre qué elegir, y ADR-094 ya le dio a ese caso su propio camino (el grupo sugerido, apagado y visible).
- **Qué cambió y por qué** (ADR-083): hasta este ADR el diálogo pedía un `ReplacementMode`, que **no resolvía el desacuerdo** — `applyConflictResolve` no tocaba el `entityType`, así que el usuario aplicaba y la discrepancia quedaba igual. El modo de reemplazo se sigue eligiendo donde siempre: el `ReplacementModeSelect` de la fila del grupo (§3.4).

---

## 7. Componentes de Export

### 7.1 `ExportDialog` (simplificado por ADR-087 §5)

- **Stores**: `document`, `entities`.
- **Render**: ver `UX_Guidelines.md` §8.2. **Dos controles**: el nombre del archivo (default
  `anonimizado.pdf`) y el checkbox "Agregar una página con la referencia de marcadores" (ADR-059 §1,
  default **apagado**), más el resumen y los botones.
- **Reabrir con un resultado vigente muestra el resultado**, no el formulario, y **conserva el
  nombre con el que se exportó** — es el que usa el ancla "Descargar". Resetear a ciegas era pérdida
  de datos: el `blobUrl` seguía en `pipeline.store` y la UI no tenía camino de vuelta a él.
- **Sin validación de formulario** (ADR-087 §5): el nombre vacío cae al default y la extensión se
  completa sola (`normalizeExportFilename`), así que no hay estado inválido que reportar.
  `validateExportForm` y el `formError` que mostraba sus mensajes se retiran con los campos técnicos. Los
  rangos de `core/Export_Engine.md` §9 se conservan como constantes y hay tests que afirman que los
  valores fijos caen adentro — es lo que reemplaza a la validación en runtime.
- **Pre-flight**: si `enabledGroups = 0`, `ConfirmDialog` anidado.
- **Acción**: `actions.requestExport(options)`, con los valores fijos de abajo + `includeMarkerLegend`.

**Campos retirados del formulario y sus valores fijos** (ADR-087 §5):

| Campo | Valor | Por qué se fija |
|---|---|---|
| `imageFormat` | `"jpeg"` | Menor tamaño a fidelidad equivalente en texto (`core/Export_Engine.md` §13 caso 6). |
| `jpegQuality` | `0.92` | Visualmente indistinguible de `1.00` en texto. |
| `dpi` | `150` | Default de `ExportConfig`. |
| `title` | `""` | `includeOriginalMetadata: false` ya protege lo que importa. |

> **El criterio del recorte**: se pregunta lo que **altera el documento**, no lo que ajusta su
> codificación. Por eso sobrevive el checkbox de la leyenda —suma una página (ADR-059 §6)— y no los
> cinco campos técnicos.
>
> **Por qué `0.92` y no `1.00`.** Se consideró `1.00` buscando "lo más cercano al original", y no lo
> consigue: el original ya se perdió al rasterizar a 150 DPI —el export es 100 % imagen
> (`core/Export_Engine.md` §11, con test de CI)—. De `0.92` a `1.00` el ojo no distingue nada en
> texto mientras el archivo crece ×3–4 sobre q 0.85 (§12), llevando un expediente de 100 páginas de
> ~20 MB a ~80–120 MB. **La palanca de fidelidad real es el DPI**, y es la única de las cinco que
> valdría exponer bajo un `▸ Opciones avanzadas` si aparece el pedido.

- **Tras apretar "Descargar"**, el panel confirma y ofrece las salidas: "Descargar de nuevo", "Abrir
  otro documento" (`actions.closeDocument`, que devuelve a ①) y "Listo".

  > **La confirmación no afirma que la descarga terminó bien**, y no es una omisión. El navegador
  > **no da ninguna señal** de éxito ni de fallo para un `<a download>`: no hay evento ni promesa.
  > El panel dice lo que sí es cierto —el archivo se generó y se mandó a descargar— y deja el
  > reintento a la vista en vez de esconderlo detrás de un fallo indetectable. Afirmar "descargado
  > con éxito" sería inventar un dato, y en una herramienta cuyo resultado **es** el archivo, esa es
  > la mentira que más caro sale.

- **Sobre el checkbox de leyenda** (ADR-059): agrega una página final con la referencia
  `prefijo → tipo` — `MAT` y `PAT` no se leen solos, y son matrícula y patente. El copy tiene que
  dejar claras las dos cosas que el usuario necesita para decidir: que **suma una página** al
  documento, y que lista **tipos, nunca los valores originales**. Lo segundo importa: es lo primero
  que un usuario asume que hace, y no lo hace ni puede hacerlo.

### 8.9 `Logo`

- **Concepto**: un documento con una línea de texto reemplazada por una barra sólida. Es lo que hace
  la app, y la barra sobre texto es el símbolo universal de "censurado".
- **Se descartó** la alternativa "incógnito de Chrome + icono de PDF": el sombrero con anteojos es
  una marca muy identificada con Chrome —usarla se lee como derivada— y su significado es "sin
  historial de navegación", que no es la promesa de Anonly.
- **`animated`**: la barra tapa el renglón que hay debajo, **una sola vez al montar**. La marca hace
  lo que la app hace. En loop convertiría la identidad en un banner.
- **El favicon (`public/favicon.svg`) no es una copia del componente**: tiene su propio ajuste
  óptico (trazo más grueso, renglones más gordos, barra más grande). A 16 px lo único que tiene que
  sobrevivir es "página con una barra cruzándola", y el detalle fino compite con eso. Colores
  literales y no tokens: se sirve suelto, sin la hoja de estilos.

---

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

- Confirmación genérica sobre `Dialog`; referenciado por `CancelButton` (§2.4) y `GroupContextMenu` (§3.5). (También lo usaba `RuleItem`, retirado por ADR-087 §3.)
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
--color-accent: #2563eb;       /* azul primario — 5.17:1 con blanco */
--color-success: #10b981;
--color-warning: #f59e0b;        /* solo relleno decorativo — ver nota */
--color-warning-strong: #b45309; /* ADR-087 §3.1: bordes, iconos y texto de precaución */
--color-error: #ef4444;
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.1);
```

> **`--color-warning-strong` es nuevo (ADR-087 §3.1) y no es un capricho de paleta.** El
> `--color-warning` de siempre da **2.15:1** contra `--color-bg-primary`, que falla incluso el 3:1
> de elementos **no textuales** (WCAG 1.4.11), así que no puede llevar un borde, un icono ni un
> texto que signifiquen algo. `#b45309` da **5.03:1**: sirve para las tres cosas. `--color-warning`
> queda para rellenos donde el color no carga información.

> **Contraste del accent — cerrado.** Era `#3b82f6`: **3.68:1** con texto blanco, bajo el 4.5:1
> que `UX_Guidelines.md` §9 promete, y afectaba a todo botón primario y a los links
> `text-accent` (ADR-087, "Fuera del alcance" §1). Ahora es `#2563eb`, **5.17:1**, que alcanza
> para las dos formas en que el token se usa: relleno con texto blanco encima, y texto sobre
> `bg-primary`.

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
| `SettingsDialog` | `settings`, `document` | `settings.persist` (+ `actions.reanalyze` si `ocrLanguages` cambia con documento abierto, `React_Client.md` §3.7, ADR-038 §7; + recreación del core si cambia el `EngineConfig` **sin** documento abierto, ADR-125 §2) | `orchestrator.reanalyze` (no es un evento del bus) |
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
| `ReplacementModeSelect` (§3.4) | `rules` | `actions.createRule` / `actions.updateRule` (scope `group`) | `RULE_CREATED` / `RULE_UPDATED` |
| `DocumentModeSelect` (§3.9) | `rules` | `actions.deleteRule` ×N + `createRule`/`updateRule` (scope `global`) | `RULE_DELETED` ×N + `RULE_CREATED`/`RULE_UPDATED` |
| `TypeModeSelect` (§3.10) | `rules`, `entities` | `actions.deleteRule` ×N + `createRule`/`updateRule` (scope `type`) | `RULE_DELETED` ×N + `RULE_CREATED`/`RULE_UPDATED` |
| Undo del toast (§3.11) | `rules` | `actions.deleteRule` + `actions.createRule` ×N (restaura el snapshot) | `RULE_DELETED` / `RULE_CREATED` |

> `RuleCreatorDialog`, `RuleEditorDialog` y `RuleItem` se retiran (ADR-087 §3). Las acciones y los
> eventos del Core **no cambian**: los mismos `RULE_*` los emiten ahora los tres selectores del
> árbol. **`ReplacementModeSelect` deja de emitir `GROUP_UPDATE_REQUESTED` con
> `patch.replacementMode`** (ADR-087 §3.1a) — el resto del patch (`enabled`, `canonicalValue`,
> `personGender`, `replacementValue`) sigue igual.
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
- `adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md` (rediseño: §1, §2, §3, §4, §5, §7)
