<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,ui/Components.md,adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md,adr/ADR-078-La-Edicion-Manual-Es-Visible-En-La-UI.md,adr/ADR-028-IndexInType-Renumeracion-Canonica.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-094 — Lo que el detector duda no se tira en silencio

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, al ver el mecanismo real detrás de §23c: la herramienta veía dos nombres propios y los descartaba sin dejar rastro.
- **Relacionado con**: ADR-073 §1 (los tres tipos de texto libre, que acá definen el alcance), ADR-078 (**el precedente**: un booleano en `EntityGroup` que el panel renderiza como marca), ADR-028 (`indexInType`), ADR-092 §3 (que cerró la carátula y dejó esto explícitamente abierto)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-094 §N` refiere a **Decisión §N**.

## Contexto

### 1. El descarte silencioso

`grouping.engine.ts#handleLowConfidence`, cuando la ocurrencia de NER está por debajo del `confidenceThreshold` **y no hay grupo candidato al que parecerse**:

```ts
if (!candidateGroup) {
  this.ctx?.logger.warn("Ocurrencia NER de baja confianza descartada sin grupo candidato; …");
  return;
}
```

Un `warn` y `return`. El logger de producción es nulo, no se emite nada al bus, y la UI nunca se entera. Sobre la carátula de `qa-stamp.pdf` el modelo etiquetó `Pérez` con 0,5924 y `Juan` con 0,6991: **la herramienta vio dos nombres propios y los tiró sin decirlo.**

Cuando **sí** hay grupo candidato, la baja confianza se convierte en un `CONFLICT_DETECTED` con razón `low_confidence` y el usuario decide. Ese diseño está bien. El agujero está en la rama "sin candidato", que es exactamente **la primera aparición de un nombre** — el caso en que se produce una fuga.

### 2. Por qué no alcanza con bajar el umbral

Es una línea en `config.ts` y cerraría el caso. Pero cambia qué se tapa en **todos** los documentos, sin dataset con el cual medir el efecto y sin control en la UI —el diálogo de ajustes expone idioma, preset de rendimiento, NER on/off e idiomas del documento; el umbral no—. El `0,7` es un número redondo que nunca se midió contra nada.

La asimetría que importa: en una herramienta de privacidad un falso negativo es una **fuga** que rompe la promesa del producto, y un falso positivo es un grupo de más que se apaga con un click. El código de hoy los trata como si fueran igual de graves.

## Decisión

### 1. Se crea el grupo, apagado y marcado

Una ocurrencia de NER por debajo del umbral y **sin grupo candidato** deja de descartarse: crea su grupo con `enabled: false` y `needsReview: true`.

Con `enabled: false`, **no se tapa nada** hasta que el usuario tilde la casilla que el panel ya tiene por grupo. O sea que esta decisión **no cambia una sola vez qué sale tapado del export**: cambia qué se le muestra al usuario.

### 2. Qué se sugiere y qué se sigue tirando

Sin filtro, el panel se llena de ruido y la sugerencia deja de significar algo. Tres compuertas, todas con razón:

1. **Solo tipos de texto libre** — `Person`, `Organization`, `Address`: los mismos tres que ADR-073 §1 ya reconoce como aquellos cuyo valor es texto libre. Una fecha o un teléfono de confianza baja no aporta: esos tipos los cubre Regex con `confidence: 1.0`.
2. **Piso de confianza**: solo se sugiere en la banda `[MIN_SUGGESTION_CONFIDENCE, confidenceThreshold)`. Debajo del piso el modelo no está dudando, está adivinando.
3. **El valor tiene que parecer un nombre propio** cuando el tipo es `Person`: su primer token está en `GENDER_LEXICON` (`@anonly/shared`, ADR-091). Es la misma compuerta que ADR-092 usó para la carátula, aplicada del otro lado del pipeline.

**El piso es provisional y hay que decirlo.** Se fija en `0,5` sin una distribución que lo respalde: no hay dataset de referencia con el cual medir cuántas sugerencias produce cada valor. Es un número elegido, no medido, y el lugar donde se calibra es el evaluador de recall/precisión cuando exista. Queda como constante nombrada, no como literal enterrado.

### 3. La promoción, que no es un detalle

`findMatchingGroup` **no filtra por `enabled`**. Sin esta decisión, un grupo apagado absorbería una ocurrencia posterior del mismo valor —incluida una de confianza alta— y **se quedaría apagado**: una detección que hoy funciona se convertiría en un dato sin tapar. El arreglo introduciría la clase de defecto que viene a cerrar.

Entonces: cuando una ocurrencia que **no** es de confianza baja entra a un grupo con `needsReview: true`, el grupo se **promueve** — `enabled: true`, `needsReview: false` — y el cambio viaja en `ENTITY_GROUP_UPDATED` como cualquier otro.

Es la parte de este ADR que más fácil se olvida y la única que, omitida, deja el producto peor que antes.

### 4. `EntityGroup.needsReview: boolean`

Se declara primero en `Contracts.md` §5 y después en `shared/src/types.ts` (§10 regla 1 del propio Contracts). Es un booleano, no un número: **el usuario no tiene que ver "0,59"**, tiene que ver que esa entidad merece una mirada. Qué tan segura estaba la red neuronal es ruido para quien está revisando un expediente.

Precedente exacto de forma y de lugar: `EntityGroup.replacementValueUserSet` (ADR-078), un booleano que el panel ya renderiza como marca.

**La marca significa "nadie decidió todavía", y por eso se apaga con la decisión del usuario**: tildar o destildar la casilla del grupo la limpia, en los dos sentidos. Habilitarlo es aceptar la sugerencia; deshabilitarlo es rechazarla. Las dos son decisiones, y después de cualquiera de ellas la marca ya no tiene nada que pedir. Sin esta regla quedaría pegada a un grupo que el usuario ya resolvió.

`needsReview` es del **grupo**, no de la ocurrencia: es el grupo lo que el usuario revisa, y `OccurrenceRef` no lleva `confidence`, así que la UI no podría derivarlo aunque quisiera.

### 5. Lo que este ADR NO hace

- **No cambia el `confidenceThreshold`.** Sigue en 0,7 y sigue decidiendo qué se agrupa solo.
- **No cambia qué se tapa hoy.** Un grupo apagado no toca el export.
- **No incluye la UI.** El panel tiene que renderizar la marca, y eso es `apps/react-client`: otro módulo, otro PR (R-1/R-5). Hasta que ese PR entre, el grupo aparece apagado **sin explicación visible**, que es mejor que no aparecer pero no es lo que se quiere.
- **No toca `handleLowConfidence` cuando SÍ hay grupo candidato.** Ese camino sigue emitiendo `CONFLICT_DETECTED`.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Crear el grupo apagado (§1) | Bajar el `confidenceThreshold` | Cierra el caso con una línea, pero cambia qué se tapa en todos los documentos sin poder medirlo y sin control en la UI. Queda disponible para cuando exista el dataset. |
| Crear el grupo apagado | Emitir `CONFLICT_DETECTED` sin grupo | `ConflictDetected` cuelga de un `groupId` y una ocurrencia sin grupo no tiene ninguno. Sería un cambio de contrato para expresar lo mismo que un grupo apagado ya expresa. |
| Crear el grupo apagado | Dejarlo como está y confiar en el agregado manual | El usuario no puede agregar a mano lo que no sabe que existe. El `warn` va a un logger nulo. |
| Un booleano (§4) | Exponer la `confidence` en el grupo | El usuario no necesita el número y mostrarlo invita a interpretarlo como una probabilidad, que no lo es. Lo que necesita saber es a qué prestarle atención. |
| Promover (§3) | Que `findMatchingGroup` ignore los grupos con `needsReview` | Crearía un grupo paralelo con el mismo valor, y el export tendría dos tokens distintos para el mismo dato — el escenario B de ADR-082 que ADR-085 §1(a) ya tuvo que cerrar. |

## Consecuencias

**Positivas**:

- Lo que el detector duda deja de desaparecer. Vale para cualquier nombre limítrofe de cualquier documento, no solo para la carátula.
- No cambia qué se tapa: el usuario decide, y hasta que decida el comportamiento del export es idéntico al de hoy.
- La promoción de §3 hace que el camino de confianza alta sea inmune a que una sugerencia haya llegado primero.

**Negativas**:

- **`enabled: false` queda sobrecargado.** Hoy significa "el usuario lo eliminó" (`Components.md` §3.5, "Eliminar grupo"); ahora también "el detector lo sugiere y nadie decidió todavía". Los distingue `needsReview`, pero hasta que entre el PR de UI **se ven igual**.
- **El piso de confianza no está medido** (§2). Es el número más flojo de este ADR y está marcado como tal.
- Una sugerencia consume un `indexInType` aunque nunca se habilite. Es consistente con lo que ya pasa con un grupo eliminado, y ADR-028 gobierna la renumeración.
- Más grupos en el panel sobre documentos con mucho texto de texto libre. Cuántos más no se sabe hasta que el evaluador lo mida.

## Validación

- Test unit: una ocurrencia de NER de `Person` en la banda de sugerencia, sin grupo candidato, **crea** un grupo con `enabled: false` y `needsReview: true`, y emite `ENTITY_GROUP_CREATED`.
- Test unit: la misma ocurrencia **por debajo del piso** se sigue descartando en silencio.
- Test unit: una ocurrencia de baja confianza de un tipo que **no** es de texto libre (`Date`, `Phone`) se sigue descartando.
- Test unit: una `Person` de baja confianza cuyo primer token **no** está en `GENDER_LEXICON` se sigue descartando.
- Test unit (**el de §3**): un grupo `needsReview` que después recibe una ocurrencia de confianza alta queda `enabled: true` y `needsReview: false`, con `ENTITY_GROUP_UPDATED` listando los dos cambios. Sin este test el ADR puede implementarse dejando el producto peor que antes.
- Test unit: con grupo candidato, el camino sigue emitiendo `CONFLICT_DETECTED` — la no regresión de lo que ya andaba.
- Test contract: `EntityGroup` expone `needsReview` y todo grupo creado por el camino normal lo trae en `false`.
- Test unit: un `updateGroup` con `enabled` —`true` o `false`— limpia `needsReview` y lo lista en `changes`.
- Cobertura ≥ 85% líneas en `grouping-engine`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/Contracts.md` §5 (`EntityGroup.needsReview`), §10 regla 1
- `core/Grouping_Engine.md` §13 (casos de conflicto), §14
- `ui/Components.md` §3.5 (la casilla por grupo que ya existe), §3.4
- `adr/ADR-073-Difuso-Solo-Para-Tipos-De-Texto-Libre.md` §1
- `adr/ADR-078-La-Edicion-Manual-Es-Visible-En-La-UI.md` (el precedente del booleano)
- `adr/ADR-085-Memoria-De-Reclasificacion-Por-Documento.md` §1(a) (dos grupos para el mismo valor, el escenario que §3 evita)
- `adr/ADR-091-El-Lexico-De-Nombres-No-Es-De-Un-Motor.md` §1 (el léxico que §2 usa)
- `ai/AI_Development_Guide.md` R-1, R-2, R-13, R-18, R-19, R-21
