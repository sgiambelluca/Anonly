<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,core/Contracts.md,adr/ADR-092-La-Caratula-Es-Un-Patron-No-Un-Caso-De-Modelo.md,adr/ADR-103-La-Caratula-Se-Reconoce-Por-Su-Contexto.md,adr/ADR-112-El-Sello-No-Es-Un-Parrafo.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-091-El-Lexico-De-Nombres-No-Es-De-Un-Motor.md,roadmap/OCR_Escaneos_Handoff.md | audiencia=humanos+IA | fase=11 -->

# ADR-122 — Una carátula se escribe en mayúsculas

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, sobre el hueco (b) que `OCR_Escaneos_Handoff.md` §3.3 dejó anotado.
- **Relacionado con**: **ADR-092** (que creó el patrón) y **ADR-103** (que le puso el anclaje por contexto), ADR-112 (que hizo legible el sello donde vive la carátula), ADR-117 (cuya regla de contención decide qué pasa con las ocurrencias que la carátula absorbe)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** Precedente: ADR-084.

## Contexto

### 1. El patrón estaba apagado justo sobre el formato para el que se escribió

`caratula-ar` exigía `\p{Lu}\p{Ll}+` de los dos lados de la coma —una mayúscula seguida de **minúsculas**— y un `s/`/`c/` en minúscula. Una carátula de expediente se escribe así:

```
SUAREZ, BARTOLOME ARTURO S/ RECURSO DE CASACIÓN
```

Medido sobre un fallo escaneado de 20 páginas: **0 matches**, incluida la cita del cuerpo `caratulada “SUAREZ, BARTOLOME ARTURO S/ RECURSO DE CASACIÓN”`, donde la marca `caratulada` está pegada. El apellido del imputado quedaba enteramente en manos del modelo, sobre el formato **más previsible que hay en un expediente**, que es exactamente lo contrario de para lo que ADR-092 creó este patrón.

Tres cosas lo bloqueaban a la vez, y hasta no arreglar las tres el patrón sigue en cero:

| bloqueo | qué exigía | qué dice el documento |
|---|---|---|
| caja | `\p{Lu}\p{Ll}+` | `SUAREZ`, `BARTOLOME` |
| cantidad de nombres | uno solo | `BARTOLOME ARTURO` — dos |
| separador | `s/` `c/` en baja | `S/` en alta, y `8/`/`$/` cuando el OCR falla |

### 2. Censo del corpus, para saber contra qué se mide

Sobre los 8 documentos cacheados: **109** formas `Palabra, Palabra` en total, de las cuales **20 son carátulas reales** —las 19 del encabezado más la cita del cuerpo de la p1— y todas están en caja alta. O sea que las otras 89 son el terreno donde un patrón más flojo se puede equivocar.

## Decisión

### 1. Los dos lados aceptan caja alta, y el separador también

`\p{Lu}\p{L}+` en vez de `\p{Lu}\p{Ll}+`, y `[CS]\/` junto a `[cs]\/`.

### 2. Los nombres de pila son varios **solo cuando la carátula cierra**

ADR-092 §1 limitó el nombre a **una palabra**, y su razón sigue siendo válida donde la dio: sobre `Firmado: Echeverria, Marta Date: 07/07/2026` un cuantificador goloso matchea `Echeverria, Marta Date`, la ocurrencia cruza al run siguiente, su envolvente se estira sobre los dos y Grouping **hace desaparecer** el grupo de Fecha por solapamiento. Eso no era un límite caprichoso: era que **no había nada que frenara al cuantificador por la derecha**.

Cuando la carátula termina en `s/` o `c/`, el freno existe y es explícito. Ahí —y solo ahí— el tramo se abre a `{1,3}` nombres. La rama anclada por **marca** (`Autos:`, `caratulado`, `perito a`…) queda **exactamente como estaba**: una palabra de cada lado, en Título.

Es la diferencia entre las dos vías de anclaje de ADR-103: la marca ancla por la izquierda, el `s/` ancla por la **derecha**, y solo la segunda acota lo que el match se puede tragar.

**El orden de las dos ramas importa.** La alternancia de JS es ordenada y las dos arrancan en el mismo índice, así que si la rama de la marca va primero se queda con el match corto: sobre `Autos: López, María Fernanda c/ Empresa` devuelve `López, María` en vez de `López, María Fernanda`. La rama con cierre va primero. Lo encontró un test, no una lectura.

**Por qué 3 y no 2 ni 4**: el corpus **no distingue** — `{1,2}`, `{1,3}` y `{1,4}` dan idénticos 20/20 y un hallazgo extra. La elección es de criterio, no de medición: dos nombres de pila es lo común en un expediente argentino y tres deja margen sin que el número importe mucho, porque **el límite real es el `s/`**, no la cuenta. Queda escrito para que nadie lo lea como un valor medido.

### 3. Los dos glifos que el OCR pone en lugar de la `S`

En 2 de las 20 páginas Tesseract no lee la `S` de `S/`: devuelve `8/` (p5) y `$/` (p13). Con `[CS]\/` el patrón queda en **18/20**; con `[CS8$]\/`, en 20/20. Son los dos glifos que aparecieron de verdad, no una lista defensiva — y por eso el conjunto es cerrado y no un `\S\/`, que aceptaría anclar en el `24/` de una fecha.

## Consecuencias

**Lo medido**, con el patrón de producción contra el corpus entero:

| | antes | después |
|---|---|---|
| carátulas del escaneo | **0/20** | **20/20** |
| otros hallazgos en 7 documentos | 0 | **1** |
| las 5 trampas de ADR-092 y ADR-103 | ninguna matchea | **ninguna matchea** |
| `pnpm test:quality` (26 documentos) | 61/61 recall, 61/62 precisión | **idéntico** |

**El "otro hallazgo" no es un falso positivo**: es `Alberti, Marta Beatriz c/ Provincia de Corrientes`, una carátula real de otro documento que el patrón anterior perdía porque tenía dos nombres de pila. Es un acierto que se suma, no un costo. (Su apellido, `Ríos de Paz Alberti`, entra truncado: la limitación de ADR-092 sobre el apellido compuesto sigue igual y no se toca.)

**El riesgo de ADR-092 no se materializa, y está medido y no supuesto.** Corriendo regex y NER sobre las 20 páginas y comparando índices: de las 40 vecinas que tocan una carátula, **0 son de otro tipo**. Ninguna entidad desaparece.

**Lo que sí cambia es cómo se reparten los grupos**, y conviene tenerlo escrito porque no es obvio: **35** ocurrencias de NER del mismo tipo quedan **contenidas enteras** en una carátula (los `SUAREZ` y `BARTOLOME ARTURO` que el modelo emite por separado), y por ADR-117 esas no se registran. **No se pierde cobertura** —la carátula es más ancha y las incluye, coma incluida—, pero el grupo `suarez` deja de contar las del encabezado y aparece uno nuevo, `bartolome arturo suarez`. Otras 5 se solapan **parcialmente** y conviven, que es lo que ADR-117 hace con lo que no está contenido entero.

Esto **corre el número con el que se justificó ADR-117**: aquella medición dio 1 contención en 763 ocurrencias y la llamó "un artefacto del barrido literal, no del detector". Sobre un escaneo con carátula pasa a ser un mecanismo de todos los días. La regla no cambia de sentido —la caja más ancha gana—, pero la frase de que la contención es rara ya no vale para este tipo de documento.

**En contra**

- **Un solo documento del corpus tiene carátulas.** Los 20 aciertos son 20 apariciones del **mismo** encabezado; como evidencia de que el formato se lee, alcanza, pero no dice nada sobre cuántas variantes de carátula hay en la provincia.
- **`8/` y `$/` salen de una única página cada uno.** Si otro escáner produce otra confusión, hay que volver acá.
- **La caja alta afloja la forma** en la rama del `s/`: ahora `PROVINCIA, BUENOS AIRES` es una forma aceptable y lo único que la frena es el léxico de nombres de pila (ADR-091). En el corpus no pasó ni una vez, pero la compuerta que queda es una sola.

**Lo que no toca**: `entityType`, `checksum`, `normalizer`, `maskFormat`, la rama anclada por marca, el apellido de una sola palabra, ni ningún contrato.

## Qué hay que cubrir con tests

- Una carátula en **caja alta** con dos nombres de pila y `S/` se detecta, y normaliza a la misma clave que el nombre en prosa (si no, el export nombraría a la misma persona con dos tokens).
- Los nombres de más entran **solo con cierre**: el mismo nombre, con `c/` da los dos y sin cierre da uno.
- `8/` y `$/` anclan igual que `S/`.
- La trampa de ADR-092 (`Firmado: Echeverria, Marta Date: 07/07/2026`) sigue dando `Echeverria, Marta` — el test ya existía y **no se toca**.
- Revertir el orden de las ramas tiene que romper algo: si no, nada fija que la rama con cierre va primero.
