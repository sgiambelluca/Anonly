<!-- CONTEXT: scope=revision-B05 | dependencias=roadmap/hardening/Hardening_Revision_2026-09/Mapa.md,core/Grouping_Engine.md,adr/ADR-170-Las-Vistas-Previas-De-Edicion-Las-Calcula-El-Core.md,adr/ADR-172-Deshacer-Y-Rehacer-Exactos.md | audiencia=planificador+humano | fase=11 (REJECTED de bloque) -->

# B05 — Grouping

GPT-6 Sol, 2026-09-26; base `bbb015f169b3590767565c9908f4bb879d27c91c`, HEAD `bea529507d8d21b345f6135dfb14dddcfcb1d4f4`. **REJECTED**, limitado B05. Sin cambios versionados/builds/commits/gates globales.

## Hallazgos confirmados

**B05-F01 — P2, nuevo: split synthetic preview difiere del resultado aplicado.**

`packages/anonymization-core/grouping-engine/src/grouping.engine.ts:2163` asigna randomUUID al grupo dividido. Sandbox preview y aplicación real generan IDs distintos, usados por sintetizador.

Norma: Grouping caso47 «Su resultado coincide con el grupo que emite el pedido real inmediatamente después», ADR170 §2, R2/R15. Repro: Person dos ocurrencias, modo synthetic, cinco previews misma división segundo member y aplicación. Previews José Medina/José Sánchez/José Díaz/Juan Castro/Fernando Medina; aplicación José Castro. Snapshot puro, pero reemplazo aprobado cambia al confirmar. Test existente usa placeholder y no cubre seed por ID.

**B05-F02 — P2: nuevo contrato incumplido sobre comportamiento preexistente al entrar member angosto.**

`grouping.engine.ts:732` calcula preview con members actuales; :3618 añade ocurrencia sin recalcular replacementValue. finishSession con índice estable no corrige.

Norma: Grouping caso46/ADR170 §1 «Con replacementValueUserSet === false, replacementPreviews[replacementMode] === replacementValue». Repro dos apariciones separadas Juan Perez, primera bbox ancho y segunda ancho10/alto12, sin edición manual: valor vigente [HOMBRE 01], preview.placeholder [HOM-01], persiste finish. Modo muestra valor distinto del reemplazo vigente.

Contradicción: Grouping §Escalera (:840) y §15.15c conservan «sin disparadores nuevos» ADR057; ADR170 exige igualdad en todo grupo emitido. **Pregunta:** ¿al ingresar member que cambia abreviatura se recalcula valor vigente o se cambia contrato de previews? Sin resolución silenciosa.

**B05-F03 — P2, nuevo: restore checkpoint cambia groupId de conflicto sin emitir diferencia.**

`grouping.engine.ts:2920` solo compara resolved/resolvedType, omite groupId. Norma: Grouping §6 restore/§13 caso52, ADR172 §1 reconstrucción por eventos, R2/R15.

Repro: dos grupos Email; choque manual retenido primero; fusionar en segundo y checkpoint; dividir ocurrencia a grupo nuevo; restaurar. Snapshot devuelve conflicto al sobreviviente del checkpoint, CERO CONFLICT_* emitidos. Consumidor conserva asociación a grupo que desapareció. Snapshot correcto, reconstrucción por eventos incompleta.

## Evidencia y límites

22 archivos: ADR170–178/182–184, Grouping spec, engine/labels/levenshtein, contract/edge/unit/snapshot/helper/snap. Contracts y estándares/mapa completos. Tests extensos mediante inventario y lecturas focalizadas, no revisión línea por línea de cada test.

Checklist completo: scope/campaña/excepciones inspeccionados, no rechazo por squash/diff acumulado; interfaces/errores sin otro defecto nuevo confirmado; eventos fallan F03; casos46/47/52 fallan; tests verdes sin estos escenarios; nombres/localizaciones y checkboxes históricos desfasados; prohibiciones sobre adiciones sin infracción confirmada; contratos nuevos documentados.

Índice candidatos/orden/aliases/invalidación/reconstrucción/fallback/distancia/afijos revisados, diferencial cubre comparador/thresholds/UTF16/límites/precedencia. Sin desviación algorítmica adicional confirmada ni afirmación de rendimiento universal subcuadrático.

- `pnpm exec vitest run packages/anonymization-core/grouping-engine`: **5 suites,214 PASS** (cancel2/snapshot1/contract35/edge111/unit65).
- `pnpm exec tsx --tsconfig tests/tsconfig.json /tmp/b05-probe.mts`: **exit0**, GroupingEngine/EventBus reales, tres repros. Probe temporal externo al repo.
- Diff/history/rg/lecturas numeradas; HEAD estable y único untracked directorio QA. Sin cobertura nueva; gates B11/campañas B10.

Cruce B07: resolver conflicto y restore checkpoint previo reemite CONFLICT_DETECTED mismo ID. bus-bridge:263 usa addConflict; entities.store:161 append sin upsert; conserva resuelto+pendiente. resolveConflict usa spread campos previos. Validación/hallazgo UI B07; distinto de F03 Core. Export guard/manualOutcome ya B02. Informe no aprueba branch.
