<!-- CONTEXT: scope=revision-B08 | dependencias=roadmap/Hardening_Revision_2026-09/Mapa.md,ui/React_Client.md,ui/Components.md,ui/UX_Guidelines.md | audiencia=planificador+humano | fase=11 (REJECTED estático con control helper) -->

# B08 — Componentes e interacción UI

GPT-6 Sol, 2026-09-26. Base `bbb015f169b3590767565c9908f4bb879d27c91c`, HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4` estable. **REJECTED**, solo B08. Sin archivos modificados.

## Hallazgos nuevos

**B08-F01 — P1: selector inestable en resolver de solapes.**

`apps/react-client/src/components/conflicts/ManualOverlapDialog.tsx:50–54` selector map/filter retorna nuevo array cada consulta. Zustand5 instalado usa React.useSyncExternalStore con selector(api.getState()), sin shallow. React_Client §3.6b (:526) describe loop por Object.is; Components §6.3 exige diálogo resoluble.

Trigger agregado manual que solapa grupo detectado/heldConflictIds o Resolver desde aviso/badge. Estabilidad rota por identidad; puede provocar loop/máxima profundidad, inutilizando diálogo. Defecto de selector confirmado por lectura componente/dependencia; efecto runtime inferido, **sin montaje DOM/pantalla en blanco observada**. B11 recibe trigger para control con Electron fresco. Distinto conflicto duplicado B07.

**B08-F02 — P1: búsqueda declara oculto texto de grupo deshabilitado.**

`components/viewer/searchResults.ts:89–100`, consumo DocumentSearchBox.tsx:144: compara geometría/página, no enabled. Retorna hidden para grupo apagado/needsReview. Normas Contracts §5 needsReview enabled=false «no tapan nada», Components §3.4d/§5.4c oculto/sin ocultar, UX1 estado real.

Trigger apagar checkbox/buscar texto o sugerencia apagada. Fila/resumen dicen oculto aunque anonimizado muestra dato; fila pierde Agregar como.

Control helper real con pnpm exec tsx -e sin archivos, fixture bbox coincidente enabled=false/needsReview=true: `{"status":{"kind":"hidden","groupId":"disabled-fixture","type":"person","indexInType":1},"summary":{"hidden":1,"unhidden":0}}`, exit0. Sin DOM/suite global.

**B08-F03 — P2: toast Deshacer puede deshacer otra edición.**

`components/entities/editHistory.ts:25–30,49–50`, applyEdits.ts:87–93, ReplacementModeSelect.tsx:61–77. Toast enlaza undoLastEdit (pila vigente al clic); edición silenciosa posterior agrega checkpoint sin retirar/reemplazar toast. history.store:186–199 evidencia secundaria no lo retira.

UX §3.3b (:356) exige que botón deshaga «siempre la que el toast nombra»; Components §3.11 admite cambios silenciosos, no desajuste. Trigger editar reemplazo/toast y cambiar género o modo sin replacement manual antes de expirar; clic Deshacer deshace género/modo posterior y mensaje sigue nombrando reemplazo anterior. Confirmación estática bindings, sin DOM. Dueño componente, no restauración interna B07.

**B08-F04 — P3: dos text-xs nuevos incumplen piso14px.**

ManualOverlapDialog.tsx:148 y toolbar/ExportButton.tsx:108 añaden text-xs12px sin override en tailwind. UX §9 (:897/:911–913) exige mínimo14px y ningún text-xs. Trigger resolver manual o conflicto export bloqueado; rótulo y motivo accionable12px. Norma explícita, no preferencia estética; sin screenshots/medición de contraste.

## Preexistentes y preguntas

- DegradedBadge.tsx:97 → applyGroupMode/updateGroup replacementMode no gana frente Rule; ADR087 §3.1a exige Rule scope group. Base ya emitía mismo patch (:96): nuevo helper agrega historial pero no origina ineficacia. No contado nuevo rechazo.
- Components §5.4c búsqueda visible ambos visores, explicación residual buscador solo Original; §5.4b/PdfViewer:284–285 overlay Original. ¿Anonimizado requiere otro resaltado o solo navegación/lista? Sin rechazo por ambigüedad.
- §3.10 undo snapshot reglas residual frente §3.11/ADR172 checkpoint. Implementación sigue mecanismo nuevo.
- §10 modo oscuro futuro residual frente ADR169 §8 temas implementados. No rechazo al tema por frase histórica.

## Evidencia, alcance y límites

Inventario94 archivos B08: App; common/conflicts/entities/screens/toolbar/viewer; index.css/vite-env/Tailwind/Vite y nueve docs ADR070/087/150/152/168/169 + UI specs. Estado final y diff lógica/interacción leídos; estilos estáticos. Algunas salidas agregadas truncadas, se reabrieron secciones de hallazgos; no certificación exhaustiva de cada párrafo histórico. Contracts/reglas/mapa, ADR172 y referencias edición/conflictos consultados. Skill ui-ux-pro-max Quick Reference como apoyo subordinado specs desktop, sin requisitos mobile inventados.

Checklist revisado: campaña/squash/contratos públicos/actions adapter/canal UI; errores locales sin exigir EngineError fuera Core; extremos apagados/sugeridos/conflictos/not-found/merge/split/modos/undo/cancel/zoom; teclado/Escape/labels/foco/reduced-motion/tipografía/loading/toast por lectura. No nuevos tipos Core ni prohibiciones buscadas; console.error UI no P4 (solo packages).

Solo control F02 ejecutado exit0; tests UI B07 y gates/build/E2E B11. Sin builds/campañas/apps/screenshots/DOM ni certificación visual/cobertura. Cruces B05 previews/groupId y B07 duplicado/cancel no repetidos. B11 debe confirmar montaje resolver, toast silencioso, estados búsqueda y visual con build fresco. No aprobación integrada.
