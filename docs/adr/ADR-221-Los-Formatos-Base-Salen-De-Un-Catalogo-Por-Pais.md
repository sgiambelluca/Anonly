<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Regex_Engine.md,core/Grouping_Engine.md,architecture/03_Data_Model.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-072-El-Valor-Sintetico-Identifica-Al-Grupo-No-A-Su-Numero.md,adr/ADR-096-Los-Patrones-Cubren-Como-Se-Escribe-El-Dato.md,adr/ADR-217-Una-Direccion-Con-Palabra-Clave-Es-Un-Patron.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-221 — Los formatos base salen de un catálogo por país

- **Estado**: Aceptado por el mantenedor el 2026-10-19, con los detalles
  técnicos del planificador (`Plan_1.1.md` §4). El contenido de los catálogos de Chile y Uruguay se decide
  después, con su medición (§6), para la 1.1.1 (§7).
- **Fecha**: 2026-10-19.
- **Decidido por**: el mantenedor (2026-10-13 y 2026-10-19), a propuesta del
  planificador.
- **Origen**: `Roadmap_1.x.md` §4 y [`Plan_1.1.md`](../roadmap/Plan_1.1.md).
- **Alcance**: contrato (`Contracts.md`), `regex-engine`, `grouping-engine`,
  el sintetizador de `@anonly/shared` y `react-client`. Sin dependencias
  nuevas.
- **Relacionado con**:
  - ADR-057: la escalera de etiquetas;
  - ADR-072: el valor sintético por grupo;
  - ADR-096 y ADR-217: cómo se mide un patrón antes de adoptarlo;
  - ADR-219, ADR-220 y ADR-223.

## Contexto

### 1. Hoy todo es argentino

- `Regex_Engine.md` §2 carga «los patrones default de tipos argentinos» y
  los exporta como `DEFAULT_PATTERNS_AR`.
- Las etiquetas de ADR-057 usan nombres argentinos: `DNI`, `CUIT`,
  `MATRICULA` y `PATENTE`.
- El sintetizador genera valores con forma argentina: un DNI sintético es
  «39.123.456».

Con un catálogo de Chile, un RUT saldría como `[DNI 01]`, y en modo
sintético tendría forma de DNI argentino, sin dígito verificador.

### 2. Lo que decidió el mantenedor

El 2026-10-13:

- la configuración de país elige de qué catálogo salen los formatos de los
  tipos base, y los tipos base conservan su identidad;
- se elige un solo país.

El 2026-10-19:

- **opción B+**: un solo país activo, con las etiquetas de ese país. Un
  formato de otro país se agrega suelto, como formato propio («agregar desde
  otro país»);
- los países son **Argentina, Chile y Uruguay**. La 1.1 sale con Argentina
  sola, y Chile y Uruguay salen en la 1.1.1 (§7);
- los formatos base con control solo se prenden y apagan; los de pura forma
  se editan (ADR-220 §4);
- un formato agregado desde otro país conserva su control (sin objeción a
  la propuesta del planificador);
- **cada catálogo trae sus generadores sintéticos.** Un RUT sintético tiene
  un dígito verificador válido.

## Decisión

### 1. Un país activo

```ts
// Contracts.md §5
export type CountryCode = "AR" | "CL" | "UY";
```

- **En la 1.1 el tipo es solo `"AR"`.** `"CL"` y `"UY"` entran al tipo en la
  1.1.1, junto con sus catálogos (§7), para que ninguna configuración pueda
  elegir un país sin catálogo.
- El país va en `EngineConfig.detection.country` (ADR-223 §2).
- El default es `"AR"`. Quien actualiza a la 1.1 sigue en Argentina sin
  notar nada.

### 2. Qué tiene un catálogo

**Cada país trae sus formatos de los tipos que dependen del país:**
documento, identificación tributaria, teléfono, matrícula y patente, según
lo que exista allá.

**Los formatos universales son los mismos para los tres países:** email
(con su segunda búsqueda de ADR-211), IBAN, tarjeta, las dos fechas,
carátula y dirección con palabra clave. Las dos fechas, la carátula y la
dirección están escritas para el español del Río de la Plata. Cómo se
comportan con textos de Chile y Uruguay lo dice la medición de §6.

**Cada formato base declara:**

- su `id`;
- su tipo base;
- si es `structure` o `control` (ADR-220 §4);
- su `maskFormat` y su normalizador.

Los ids de Argentina no cambian (`dni-ar`, `cuit-ar`, …). Los de los otros
países llevan el país adelante (`cl:…`, `uy:…`).

### 3. Los tipos base se llaman como en cada país

- **La identidad del tipo no cambia.** Es el valor de `EntityType`.
- **Lo que cambia es el nombre.** Cada catálogo define cómo se llama cada
  tipo base en la interfaz y en la escalera de etiquetas, por ejemplo
  `DNI` → `RUT`. Para eso, `grouping-engine` elige el juego de etiquetas
  según `detection.country`. Argentina conserva la tabla de ADR-057 tal
  cual.
- **Un tipo base sin formatos en un país** no aparece en el árbol de
  formatos de ese país, y no se ofrece al agregar o reclasificar una
  entidad (ADR-219 §6). Cuentan los formatos base del catálogo y también
  los propios y las referencias asociados a ese tipo. Un formato propio
  bajo Matrícula mantiene a la vista el tipo Matrícula aunque el país
  activo no tenga matrículas en su catálogo.
- **Los tipos que detecta el modelo** (persona, organización y dirección)
  existen en los tres países.

### 4. El sintético depende del país

```ts
// Contracts.md §5
export interface SyntheticRequest {
  // ...campos actuales
  readonly country: CountryCode;   // nuevo
}
```

- Los tipos que dependen del país sortean con el generador de su catálogo.
- Los universales no cambian.
- **Los generadores de Argentina dan, con la misma semilla, el mismo valor
  que hoy.** Un documento argentino no cambia de valor sintético al
  actualizar (ADR-072).
- Un formato agregado desde otro país (§5) toma el tipo del país activo, así
  que sintetiza con el generador del país activo. Es coherente con su
  etiqueta, que también es la del país activo.

### 5. Ajustes por país, y agregar desde otro país

- **Los ajustes de los formatos base se guardan por país**: qué está
  prendido y qué copias editadas hay (ADR-223 §3). Al pasar a Chile y
  volver a Argentina, el usuario encuentra lo suyo.
- **Los formatos propios no dependen del país.**
- **«Agregar desde otro país»** crea una referencia propia a un formato de
  otro catálogo:

  ```ts
  // Contracts.md §5
  export interface CatalogFormatRef {
    readonly id: string;                 // "ref:" + UUID v4
    readonly country: CountryCode;       // el catálogo de origen
    readonly catalogFormatId: string;    // "cl:rut", por ejemplo
    readonly enabled: boolean;
  }
  ```

  - El formato corre con su definición de origen, **control incluido**.
  - Si es `structure`, editarlo crea una copia propia, como con un formato
    base (ADR-220 §4).
  - Cae bajo el tipo base que declara su catálogo de origen, y se etiqueta
    como ese tipo en el país activo. Un RUT agregado con Argentina activa
    sale `[DNI 01]`.

### 6. El contenido de Chile y Uruguay se mide antes de escribirse

Este ADR fija el mecanismo, no las filas. Antes de escribir las filas de
`Regex_Engine.md` y las tablas de etiquetas y de generadores, hay un frente
de investigación por país (`Plan_1.1.md`, frente F6) que arma:

- la lista de formatos y a qué tipo base va cada uno;
- el nombre de cada tipo base en el país, y su escalera de etiquetas;
- qué formatos llevan control, y cuál;
- la máscara y el normalizador de cada formato;
- los generadores sintéticos;
- un corpus sintético del país y su medición. La medición incluye lo que se
  detecta, lo que se tapa de más y si cambia algo sobre el corpus argentino.

**El mantenedor aprueba esas tablas antes de que se escriban en los specs**,
como con ADR-217. Hoy no hay documentos reales de Chile ni de Uruguay: el
informe dirá qué sale solo de sintéticos.

### 7. Cuándo sale cada país

Decisión del mantenedor del 2026-10-19:

- **La 1.1 sale con el mecanismo y con Argentina.** Con un solo país, el
  selector de país y «agregar desde otro país» quedan ocultos, igual que el
  selector de idioma (`Roadmap_1.x.md` §10).
- **Chile y Uruguay salen en la 1.1.1**, y con ellos aparecen el selector y
  «agregar desde otro país».

Por la regla de numeración de `Roadmap_1.x.md` §1, sumar países es una
capacidad nueva y correspondería a una versión menor. Va en un parche por
decisión del mantenedor, con el precedente de «Novedades» en la 1.0.2
(`Roadmap_1.x.md` §2ter). Las notas de la 1.1.1 dicen que cambia la
detección para quien elija esos países.

## Lo que no cambia

- **El catálogo argentino** son los mismos formatos de hoy, con sus ids, su
  orden y su comportamiento medido. La línea de base de calidad, hoy 78 de
  78, tiene que quedar idéntica con Argentina y sin formatos propios.
- La identidad de los tipos base y su numeración.

## Consecuencias

**A favor**

- Un usuario de Chile o de Uruguay recibe etiquetas y sintéticos de su país.
- Mezclar países es una decisión explícita, formato por formato.

**En contra**

- **Cada país es trabajo de catálogo, de medición y de generadores**, y sale
  como cambio de detección en las notas de la versión.
- **Las etiquetas dejan de ser una sola tabla**: hay una por país.
- **Un formato agregado desde otro país toma la etiqueta y el sintético del
  país activo**, no los del suyo.

## Cómo se verifica

- Con `"AR"` y sin formatos propios, la detección, las etiquetas y los
  sintéticos son idénticos a la 1.0.2.
- Con `"CL"`, un tipo base usa la etiqueta y el generador de Chile, y un
  sintético del documento chileno pasa su propio dígito verificador.
- Un tipo sin formatos en el país no aparece en los selectores.
- Los ajustes de Argentina sobreviven a pasar por Chile y volver.
- Una referencia a `cl:…` con Argentina activa conserva su control, cae
  bajo su tipo y se etiqueta como en Argentina.
