<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Grouping_Engine.md,core/Regex_Engine.md,adr/ADR-060-Reemplazo-Por-Genero.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md,adr/ADR-070-Atribucion-Visible-En-El-Producto.md,adr/ADR-061-Agregado-Manual-De-Entidades.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=11 -->

# ADR-091 — El léxico de nombres no es de un motor

- **Estado**: Accepted
- **Fecha**: 2026-08-26
- **Decidido por**: El humano, al ver que la carátula `Apellido, Nombre` (§23c) necesita una compuerta de nombres propios y que la única que existe está encerrada en `grouping-engine`.
- **Relacionado con**: ADR-069 §1/§2 (fuente única y artefacto generado), ADR-060 §4 (la inferencia que lo consume hoy), ADR-070 (la atribución CC-BY, que no cambia), ADR-061 §2 errata (**el precedente exacto**: dos primitivas promovidas a `shared` por no tener dónde vivir)
- **Parte de**: la campaña de calidad de detección abierta por `roadmap/Calidad_De_Deteccion_Informe.md`

> Convención de citas: `ADR-091 §N` refiere a **Decisión §N**.

## Contexto

### 1. Una tabla de 9.788 nombres, encerrada por accidente

`gender-lexicon.generated.ts` son las "Nombres Permitidos" de Buenos Aires (CC-BY-2.5-AR) convertidas a un módulo TypeScript con procedencia y hash (ADR-069 §2). Vive en `grouping-engine` porque ahí se necesitó primero — para inferir el género del reemplazo (ADR-060 §4). No hay ninguna razón de diseño por la que sea de ese motor.

### 2. El segundo consumidor ya existe y no puede alcanzarla

`§23c` del gate manual es la carátula judicial `"Pérez, Juan"`, que el NER no resuelve: sobre el texto real etiqueta `Pérez` con 0,5924 y `Juan` con 0,6991, los dos por debajo del `confidenceThreshold` de 0,7. Es un **patrón**, no un caso de modelo — pero un patrón `Palabra, Palabra` a secas es inservible, porque matchea `"Buenos Aires, Argentina"`, `"San Miguel, Tucumán"` y `"Código Civil, Título III"`.

Medido sobre 16 casos, con el léxico como compuerta del nombre de pila y sin él:

| | aciertos |
|---|---|
| solo el patrón | 7 de 10 |
| patrón + léxico | **15 de 16** |

El léxico es lo que vuelve viable al patrón. Y `regex-engine` **no puede importarlo**: P-1/P-2 prohíben que un motor importe otro, y ESLint lo bloquea con `no-restricted-imports` sobre `@anonly/*-engine`.

### 3. Hay un tercer consumidor, en el mismo motor que ya lo tiene

Grouping descarta en silencio una ocurrencia de NER de confianza baja cuando no hay grupo candidato (`handleLowConfidence`). Una de las compuertas para decidir cuáles de esas vale la pena mostrar es justamente el léxico: una Persona de confianza baja cuyo valor contiene un nombre de pila conocido casi seguro es real. Ese consumidor no necesita la mudanza —ya está en `grouping-engine`— pero confirma que la tabla es de dominio, no de motor.

### 4. `shared` ya tiene una lista de nombres, y NO hay que fusionarlas

`shared/src/synthesizer.ts` tiene `PERSON_FIRST_NAMES`: 15 nombres con género. Parece una duplicación y no lo es. Esa lista existe para **generar** valores de reemplazo falsos, y tiene que quedarse chica y curada: un documento anonimizado que dijera "Abdecalas" sería peor que uno que dice "Carlos". Son dos artefactos con propósitos opuestos —uno reconoce, el otro inventa— que casualmente son listas de nombres. Queda anotado para que nadie proponga unificarlas.

## Decisión

### 1. El artefacto generado se muda a `@anonly/shared`

`gender-lexicon.generated.ts` pasa a `shared/src/`, y `scripts/build-gender-lexicon.ts` emite ahí. La procedencia (`gender-lexicon.provenance.json`) se muda con él, a `shared/assets/`. La **fuente, el filtro y el contenido no cambian**: mismo CSV, mismo mapeo `F→f`/`M→m`/`A→ambiguous`, mismo hash. Es una mudanza, no una regeneración.

`GenderLexicon` y `GenderLexiconLabel` se declaran en `Contracts.md` §5 y en `shared/src/types.ts` antes que en el código que los usa (§10 regla 1 del propio Contracts).

### 2. La inferencia se queda en `grouping-engine`

`inferPersonGender` **no se muda**. Es el algoritmo de ADR-060 §4 —con su orden de pasos, su descarte de la heurística de terminación y su guarda de iniciales de ADR-069 §3— y su único consumidor es Grouping. Lo que se comparte es **el dato**, no la política de cómo interpretarlo.

Es la misma línea que trazó ADR-061 §2 errata al promover `sharesVerticalBand`: *"lo que se comparte es el criterio, no el envoltorio"*.

### 3. Lo que no cambia

- **El bundle no crece.** Son 193 KB de fuente, 34 KB comprimidos, y la app ya empaqueta `grouping-engine`: el módulo cambia de dirección, no se suma.
- **La atribución de ADR-070 queda igual.** El crédito CC-BY del `SettingsDialog` nombra la fuente, no la ruta del archivo.
- **Ningún comportamiento.** Ni una inferencia de género cambia de resultado; el artefacto es idéntico byte a byte.
- **El glob de cobertura se muda con el archivo**: `vitest.config.ts` excluye el módulo generado del cómputo, y sin actualizar esa ruta sus ~9.800 líneas de datos hundirían el threshold de `shared`.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Mudar el artefacto (§1) | Generar un **segundo** artefacto en `shared`, solo con los nombres, y dejar el de género donde está | Dos artefactos de la misma fuente que pueden divergir en la próxima regeneración. Es exactamente la duplicación que ADR-069 §1 eliminó al fijar fuente única. |
| Mudar el artefacto | Que `regex-engine` importe `grouping-engine` | P-1/P-2 lo prohíben y ESLint lo bloquea. La prohibición existe justamente para que esta clase de necesidad se resuelva promoviendo a `shared`, no abriendo una dependencia entre motores. |
| Mudar el artefacto | Poner el patrón de carátula en `grouping-engine`, donde el léxico ya está | Grouping **nunca ve `Page.text`**: recibe `Occurrence`, no texto. No puede detectar una entidad que ningún detector emitió. |
| Mudar solo el dato (§2) | Mudar también `inferPersonGender` | Es la política de ADR-060 §4 y tiene un solo consumidor. Mudarla convertiría a `shared` en dueño de una decisión de producto que no le corresponde. |

## Consecuencias

**Positivas**:

- Habilita el patrón de carátula de §23c con 15/16 en vez de 7/10, que es la única razón por la que este ADR existe.
- Una tabla de dominio deja de pertenecer al motor donde se necesitó primero. Si mañana `ner-engine` quiere validar un span contra nombres conocidos, ya está disponible.
- Cierra el mismo tipo de deuda que ADR-061 §2 errata: primitivas y datos atrapados en un motor por accidente de orden de implementación.

**Negativas**:

- **La mudanza por sí sola no mejora nada.** Es plomería: la calidad la aporta el patrón que viene después. Un ADR cuyo beneficio es habilitar otro cambio es más difícil de justificar solo, y conviene leerlo junto al que lo usa.
- `shared` pasa a contener el archivo más grande del repo después del modelo de NER. No cambia el bundle, pero sí cambia qué parece "el paquete de tipos y primitivas".
- Toca tres lugares a la vez (`shared`, `grouping-engine`, `scripts/`) más el config de cobertura. Es una mudanza, no una refactorización, pero el diff es ancho y el revisor tiene que verificar que el artefacto llegó **idéntico**.

## Validación

- El módulo generado es **byte a byte el mismo** que antes de la mudanza (mismo `sha256` en la procedencia) — es la afirmación central: si cambió, no fue una mudanza.
- `pnpm lexicon:build` regenera en la ruta nueva y el test de `tests/scripts/build-gender-lexicon.test.ts` sigue verde.
- Test unit (`grouping-engine`): la inferencia de género produce los mismos resultados que antes, importando el léxico desde `@anonly/shared`.
- `vitest.config.ts`: el glob de exclusión de cobertura apunta a la ruta nueva; la cobertura de `shared` no se hunde.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract` verdes.

## Referencias

- `core/Contracts.md` §5 (`GenderLexicon`, `GenderLexiconLabel`), §6, §10 regla 1
- `core/Grouping_Engine.md` (la inferencia, que no se muda)
- `adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md` §1, §2, §3
- `adr/ADR-060-Reemplazo-Por-Genero.md` §4
- `adr/ADR-061-Agregado-Manual-De-Entidades.md` §2 errata (el precedente)
- `adr/ADR-070-Atribucion-Visible-En-El-Producto.md` (la atribución, sin cambios)
- `ai/AI_Development_Guide.md` R-2, R-13, R-18, R-19, R-21
