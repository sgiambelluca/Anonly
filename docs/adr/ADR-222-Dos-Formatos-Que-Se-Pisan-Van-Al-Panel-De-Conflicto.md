<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,adr/ADR-083-El-Panel-De-Conflicto-Elige-Tipo-No-Modo.md,adr/ADR-107-El-Conflicto-Se-Mide-Sobre-Los-Fragmentos.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-176-Un-Choque-Pendiente-Bloquea-El-Export.md,adr/ADR-214-La-Que-Pierde-Un-Conflicto-No-Se-Descarta-Si-Cubre-Mas-Texto.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-222 — Dos formatos que se pisan van al panel de conflicto

- **Estado**: Aceptado por el mantenedor el 2026-10-19, con los detalles
  técnicos del planificador (`Plan_1.1.md` §4).
- **Fecha**: 2026-10-19.
- **Decidido por**: el mantenedor, a propuesta del planificador.
- **Origen**: la pregunta del mantenedor del 2026-10-19: si dos formatos
  prendidos colisionan, ¿el usuario puede elegir en el panel de conflicto?
- **Alcance**: contrato (`Contracts.md`, `03_Data_Model.md`),
  `regex-engine` y `grouping-engine`. Sin dependencias nuevas.
- **Relacionado con**:
  - ADR-083: el panel elige el tipo;
  - ADR-107 y ADR-117: cómo se mide un solapamiento y qué es una
    contención;
  - ADR-176: qué conflicto bloquea el export;
  - ADR-214: la perdedora que cubre más texto no se descarta;
  - ADR-219, ADR-220 y ADR-221.

## Contexto

### 1. Hoy dos formatos nunca llegan al panel

`regex-engine` resuelve los choques entre sus propios patrones antes de
emitir (`Regex_Engine.md` §13, caso 10). Gana el match más largo, y el otro
se descarta en silencio, sea del tipo que sea. El panel de conflicto de
ADR-083 solo ve choques entre detectores distintos: un formato contra el
modelo, o un agregado manual contra una detección.

### 2. No todo choque es una duda

Todo CUIT «20-12345678-9» contiene un DNI. Un RUT chileno «12.345.678-5»
también. En esos casos, el match que contiene al otro es la lectura más
completa: lleva el dígito verificador. Si cada contención abriera el panel,
cada CUIT del documento vendría con su aviso.

### 3. Lo que decidió el mantenedor (2026-10-19)

Aceptó la propuesta del planificador:

- si un formato contiene al otro, gana el que contiene, sin panel, como hoy;
- si cubren el mismo texto, o se cruzan sin que uno contenga al otro, y son
  de **tipos distintos**, hay conflicto con panel;
- si son del **mismo tipo**, no hay conflicto: es la misma entidad,
  numerada por tipo;
- por defecto gana el formato propio sobre el base. Entre dos del mismo
  origen gana el más largo;
- el conflicto no bloquea el export: nace resuelto con el valor por
  defecto, como los demás conflictos de detección.

## Decisión

### 1. `regex-engine` emite los dos matches cuando hay una duda

En la resolución de solapamientos de `process`:

| Los dos matches | Qué se emite |
|---|---|
| Uno contiene al otro | Solo el que contiene, como hoy |
| Mismo tipo | Solo el más largo, como hoy. Con el mismo largo, el propio, para que el grupo quede bajo el formato del usuario (ADR-224 §2). Hoy, en un empate, ganaría el base por orden |
| Tipos distintos, mismo tramo o cruzados, y al menos uno es propio (§5) | **Los dos** |
| Tipos distintos, mismo tramo o cruzados, y los dos son base del catálogo activo | Solo el más largo, como hoy |

### 2. La aparición dice de qué formato salió

```ts
// 03_Data_Model.md §7 y §8, Contracts.md
export interface Occurrence {
  // ...campos actuales
  readonly formatId?: string;                  // nuevo: formato o patrón que matcheó; solo source Regex
  readonly formatOrigin?: "base" | "user";     // nuevo: "user" = propio, copia editada o referencia de otro país
}

export interface ConflictCandidate {
  // ...campos actuales
  readonly formatId?: string;                  // nuevo: para que el panel nombre el formato
}
```

`OccurrenceRef` copia `formatId` de la `Occurrence`, con la misma regla de
propagación explícita que `fragments` (`03_Data_Model.md` §8).
`EntityGroup.formatId` lo usa el árbol (ADR-224 §2).

### 3. Grouping arma el conflicto con la máquina de siempre

`findOverlapConflict` ya detecta dos apariciones de tipos distintos que se
solapan más de la mitad del área menor, medida sobre los fragmentos
(ADR-107). Lo único nuevo es el desempate en `conflictWinnerIsNew`. Dos
apariciones de Regex empatan en confianza 1.0, y entonces:

1. gana la de `formatOrigin: "user"` sobre la de `"base"`;
2. con el mismo origen, gana la de valor más largo;
3. con el mismo largo, gana la que ya estaba registrada.

**Lo demás, como hoy:**

- **El conflicto nace resuelto.** Lleva `ConflictReason.Overlap`, el
  ganador como `resolvedType` y los dos candidatos, cada uno con su
  `formatId`. El usuario lo cambia desde el panel de ADR-083.
- La perdedora que cubre texto que la ganadora no cubre no se descarta
  (ADR-214).
- Dos matches cruzados que se solapan la mitad del área menor o menos no
  forman conflicto: se agrupan los dos y se tapan los dos.

### 4. No bloquea el export

ADR-176 bloquea el export solo con un conflicto **sin resolver**, y estos
nacen resueltos. Es el mismo trato que reciben hoy los conflictos entre un
formato y el modelo.

### 5. Alcance: solo cuando hay un formato propio en juego

Entre dos formatos base del catálogo activo, la resolución sigue siendo la
de hoy: gana el más largo, sin panel. Hay dos razones:

- **Es el comportamiento medido.** Quien no crea formatos ni agrega nada
  desde otro país detecta exactamente lo mismo que en la 1.0.2.
- **Con B+, nunca conviven dos catálogos base** (ADR-221 §1). Los choques
  que el mantenedor quería resolver con el panel solo aparecen cuando entra
  un formato propio, una copia editada o una referencia de otro país, y
  todos esos son `"user"`.

## Lo que no cambia

- La contención: gana el que contiene, sin panel (caso 10 de
  `Regex_Engine.md` §13, y ADR-117 en Grouping).
- El umbral y la medida del solapamiento (ADR-107).
- El panel de conflicto de ADR-083 y su valor por defecto para un formato
  contra el modelo: gana el de mayor confianza.

## Consecuencias

**A favor**

- Un formato propio que pisa otro formato no le gana ni le pierde en
  silencio. El usuario ve el conflicto y lo puede cambiar.
- Quien no usa formatos propios no ve ningún aviso nuevo en sus
  documentos.

**En contra**

- **Dos campos nuevos en la aparición** que tienen que viajar hasta el grupo
  y el panel, con el riesgo conocido de un dato que no se propaga
  (ADR-066 §6). Lo cubren tests de propagación.
- **Un documento puede traer varios conflictos resueltos por defecto** que
  el usuario no revisa. El filtro «con conflicto» de ADR-224 §3 existe para
  revisarlos antes de exportar.

## Cómo se verifica

- Un formato propio de tipo CBU y uno base de otro tipo sobre el mismo texto
  dan un conflicto resuelto a favor del propio. Resolverlo al otro tipo
  reclasifica el grupo.
- Un formato propio que contiene a uno base no da conflicto, y gana el que
  contiene.
- Dos formatos del mismo tipo sobre el mismo texto dan un solo grupo, sin
  conflicto.
- Dos formatos base de tipos distintos que se cruzan siguen resolviéndose
  como hoy.
- El export no se bloquea con estos conflictos.
- `formatId` llega de la `Occurrence` al `OccurrenceRef`, al grupo y al
  candidato del conflicto.
