<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,core/Orchestrator.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,adr/ADR-228-El-Generador-Se-Arma-Con-Piezas-Que-Se-Arrastran.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-233 — Una variante puede tener nombre

- **Estado**: Aceptado por el mantenedor el 2026-11-21. La decisión de
  producto es suya; los detalles técnicos (§1 a §4) son del planificador.
- **Fecha**: 2026-11-21.
- **Decidido por**: el mantenedor, probando el generador en la pasada de UI de
  la 1.1, a propuesta del planificador en lo técnico.
- **Origen**: pedido del mantenedor del 2026-11-21: un menú ⋯ por variante para
  cambiarle el nombre y para duplicarla como «Copia de …».
- **Alcance**: **contrato** (`Contracts.md` §5.2, `FormatDefinition` y
  `FormatIssueCode`), `shared`, `regex-engine` (`validateFormat`), façade
  (`validateFormatsFile`) y `react-client`. Sin eventos nuevos, sin constantes
  nuevas y sin dependencias nuevas.
- **Modifica**: ADR-220 §1 (qué guarda un formato) y ADR-228 §2 (las pestañas
  de variante).

## Contexto

ADR-220 §1 guarda las variantes de un formato como una lista de listas de
piezas: una variante es sus piezas y nada más. El generador las muestra como
«Variante 1», «Variante 2»… (ADR-228 §2).

Con dos o tres variantes, el número no dice cuál es cuál: «con guiones», «sin
guiones», «con la sigla adelante». El mantenedor pidió poder nombrarlas, y que
duplicar una variante cree una «Copia de …» con el nombre de la original. Lo
primero no entra en el contrato actual: no hay dónde guardar el nombre.

La 1.1 todavía no salió. Ni el archivo de formatos (ADR-223 §5) ni lo que
guarda la aplicación (`anonly:detection`) existen en una versión publicada, así
que sumar un campo opcional no rompe nada que un usuario tenga.

## Decisión

### 1. `variantNames`, opcional y en paralelo a `variants`

```ts
export interface FormatDefinition {
  // … los campos de siempre (ADR-220 §1) …
  readonly variants: ReadonlyArray<ReadonlyArray<FormatPiece>>;
  // ADR-233: el nombre de cada variante, en el mismo orden que `variants`.
  // Ausente = todas con el nombre automático. "" (o solo espacios) = esa
  // variante con el nombre automático.
  readonly variantNames?: ReadonlyArray<string>;
}
```

- **Opcional**: un formato sin el campo es válido y es lo que ya existía. Los
  formatos del catálogo (`CatalogFormatInfo.definition`) no lo llevan.
- **En paralelo y no dentro de cada variante**: cambiar `variants` a una lista de
  objetos obligaría a tocar el autómata, `testFormat`, `compareFormat` y cada
  formato `structure` del catálogo, por un dato que no cambia qué se reconoce.
- **El nombre automático no se guarda**: «Variante N» es de la interfaz, por
  posición. La aplicación omite `variantNames` cuando ninguna variante tiene
  nombre propio.
- **Largo**: hasta `FORMAT_MAX_TEXT` (40) caracteres, el mismo tope que el
  nombre del formato. Sin constante nueva.
- **Nombres repetidos**: se admiten. Son para que el usuario se ubique, y no
  identifican nada.

### 2. Dos códigos nuevos de `validateFormat`

```ts
export type FormatIssueCode =
  // … los de siempre …
  | "variant_name_too_long"      // ADR-233: con variantIndex
  | "variant_names_mismatch";    // ADR-233: variantNames no tiene el largo de variants; del formato entero
```

- `variant_name_too_long`: el nombre de la variante `variantIndex` pasa de
  `FORMAT_MAX_TEXT` caracteres (contados como el nombre del formato).
- `variant_names_mismatch`: `variantNames` está y su largo no es el de
  `variants`. La interfaz los mantiene juntos, así que solo puede venir de un
  archivo armado a mano o dañado.

### 3. El nombre no cambia qué se reconoce

- **El autómata, `process` y `testFormat` no leen `variantNames`.**
  `testFormat` no cuenta los dos códigos nuevos como problema de forma, igual
  que `name_too_long` (`Contracts.md` §5.2): un nombre largo no impide probar.
- **`compareFormat` tampoco**: dos formatos con las mismas piezas y otros
  nombres de variante son idénticos (`identicalTo`), como ya pasa con el
  nombre del formato.
- **`init`** descarta un formato con alguno de los dos códigos, como a
  cualquier formato que no pasa `validateFormat` (`Regex_Engine.md` §6). En la
  práctica no ocurre: la aplicación valida antes de guardar.

### 4. El archivo y lo guardado

- **El archivo de formatos** lleva `variantNames` dentro de cada definición,
  tal como está. No cambia `version`: el campo es opcional y la 1.1 no salió.
- **`validateFormatsFile`**: la forma admite `variantNames` ausente o como
  lista de textos; cualquier otra cosa da `schema_invalid`. El largo y el
  tope los revisa `validateFormat`, como el resto, y su falla da
  `format_invalid`.
- **`anonly:detection`**: guarda la definición entera, sin cambios en su
  versión. Un formato guardado sin nombres sigue igual.

### 5. La interfaz (precisa ADR-228 §2)

- La pestaña muestra el nombre, o «Variante N» si no tiene. Un nombre largo se
  corta con «…» y se lee entero en `title`.
- El ⋯ de cada pestaña suma **«Cambiar nombre…»**: la pestaña se vuelve un
  campo. `Enter` o salir del campo lo guarda; `Esc` lo deja como estaba, sin
  cerrar el generador; vacío vuelve al nombre automático. Doble clic sobre la
  pestaña hace lo mismo.
- **«Duplicar variante»** nombra la copia «Copia de » + el nombre que se ve
  («Copia de Variante 1», «Copia de Con guiones»), cortado a
  `FORMAT_MAX_TEXT` caracteres.
- Los textos que nombran una variante —la caja de estado, «¿Borrar …?»— usan
  su nombre entre comillas si tiene uno, y su número si no.
- Con muchas variantes, las pestañas pasan a un segundo renglón en vez de
  desbordar el diálogo.

## Lo que no cambia

- Qué reconoce un formato y cómo se recorre: ADR-220 §2.
- Los topes de `Contracts.md` §6 (`FORMAT_*`).
- `version` del archivo de formatos y de `anonly:detection`.

## Consecuencias

- **Es un cambio de contrato** y lleva su propio commit, con `shared`,
  `regex-engine` y el façade juntos (la excepción de R-1), después del commit
  de docs.
- Un archivo exportado con nombres de variante no lo lee ninguna versión
  publicada, porque ninguna lee archivos de formatos todavía.
- La interfaz gana dos textos para los códigos nuevos (`UX_Guidelines.md`
  §11b.16).

## Cómo se verifica

- `validateFormat` da `variant_name_too_long` con su `variantIndex` y
  `variant_names_mismatch` sin `variantIndex`, y nada con nombres vacíos, con
  espacios o sin el campo.
- `testFormat` reconoce lo mismo con y sin nombres, aunque un nombre sea
  demasiado largo.
- `compareFormat` da `identicalTo` entre dos formatos que solo difieren en los
  nombres de sus variantes.
- `validateFormatsFile` acepta un archivo con `variantNames` y rechaza uno
  donde `variantNames` no es una lista de textos.
- En el generador: renombrar, cancelar con `Esc`, vaciar el nombre y duplicar
  dejan los nombres esperados, y el formato guardado y reabierto los
  conserva.

## Documentación que cambia

- `Contracts.md` §5.2: `FormatDefinition.variantNames`, los dos códigos y la
  lista de lo que `testFormat` no cuenta.
- `Regex_Engine.md`: `validateFormat` y `compareFormat` (§6), caso 49 y §14.
- `Orchestrator.md`: la forma que acepta `validateFormatsFile` (caso 52).
- `Components.md` §13b.5 y `UX_Guidelines.md` §11b.16.
- ADR-228 §2: precisión que remite a este ADR.
