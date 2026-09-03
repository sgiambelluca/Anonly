<!-- CONTEXT: scope=adr | dependencias=core/NER_Engine.md,core/Contracts.md,adr/ADR-111-El-Token-Que-No-Es-Entidad-Tambien-Entra-Al-Agregador.md,adr/ADR-115-La-Puntuacion-Pegada-No-Es-Parte-Del-Valor.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-118-La-Clave-De-Agrupado-Tiene-Una-Sola-Definicion.md,adr/ADR-122-Una-Caratula-Se-Escribe-En-Mayusculas.md,adr/ADR-088-El-Texto-Que-Recibe-El-NER.md | audiencia=humanos+IA | fase=11 -->

# ADR-123 — La `S` de `S/` no es una inicial

- **Estado**: Accepted
- **Fecha**: 2026-09-02
- **Decidido por**: El humano, mirando la lista de entidades: un grupo `BARTOLOME ARTURO S` al lado del grupo bueno, cuya caja tapaba el nombre pero dejaba el apellido a la vista.
- **Relacionado con**: **ADR-111 §3** (el borde de un span es un borde de palabra — este es el mismo problema por la puerta de al lado), ADR-115 (la puntuación pegada no es parte del valor), ADR-122 (que destapó esto), ADR-117 (que es lo que hace desaparecer el grupo espurio una vez corregido el span)
- **Parte de**: Hito 11, calidad de detección

> **Los nombres de este documento son ficticios.** Precedente: ADR-084.

## Contexto

### 1. El síntoma, y por qué apareció recién ahora

Sobre el encabezado `SUAREZ, BARTOLOME ARTURO S/ RECURSO DE`, el modelo devuelve el span `BARTOLOME ARTURO S`: se lleva la primera letra de `S/`, que es la partícula que separa a las partes de una carátula.

Esto **no lo causó ADR-122** — el span está mal desde siempre. Lo que ADR-122 hizo fue **destaparlo**, y el mecanismo vale la pena escribirlo porque es de los que esconden un defecto durante meses:

| clave | ocurrencias | qué pasaba |
|---|---|---|
| `bartolome arturo` | 16 | el grupo bueno |
| `bartolome arturo s` | 3 | se **fusionaba** con el anterior |

La similitud entre las dos claves es **0,889**, y el umbral difuso de Grouping es **0,88**. Una milésima. Con ADR-122 la carátula absorbe las 16 ocurrencias de `bartolome arturo` (ADR-117: quedan contenidas enteras), así que ya no hay un grupo con quien fusionarse — y contra `bartolome arturo suarez` la similitud es 0,783. El grupo espurio queda solo y a la vista.

### 2. La forma del defecto, medida

Sobre **451** spans de `PERSON` en 8 documentos:

| | |
|---|---|
| terminan justo antes de una **barra** | **4** — y los 4 son este defecto |
| terminan en una letra suelta | 5 (los 4 de arriba, más un `I` de `I.J. N°22`) |
| terminan pegados a algo que no cierra nada | 8 (los 4, más 3 guiones y un `?`, donde el nombre sí está completo) |

La barra es una señal limpia: aparece 4 veces y las 4 son el mismo error.

## Decisión

Después del encaje de bordes de ADR-111, un paso más: **si un span termina en una letra suelta y pegado a esa letra hay una barra, la letra se descarta.**

Las dos condiciones son necesarias y cada una tapa un agujero distinto:

- **La barra**, porque es lo que prueba que la letra pertenece al token de al lado. Una inicial de verdad (`Juan P. García`) va seguida de un **punto**. Sin esta condición, la regla sería "una letra suelta al final no es parte del nombre", que es una corazonada sobre nombres y borra iniciales legítimas.
- **Que la letra sea un token suelto**, porque la barra sola no alcanza: sin esto, de `Quilmes/ La Plata` saldría `Quilme`.

Es un hecho de **tokenización**, no una interpretación del nombre: el span corta un token por la mitad, y el carácter de afuera lo demuestra. Por eso la condición mira el texto que está **fuera** del span.

Un span que se queda sin letras ni dígitos después del recorte —el modelo etiquetó la `S` sola— se descarta entero: no nombra a nadie.

**Por qué no lo arregla `snapSpansToWordBoundaries`** (ADR-111 §3): esa función **ensancha** hasta el borde de palabra, y `/` no es `WORD_CHAR_RE`, así que para ella la `S` ya es una palabra entera y no hay nada que hacer. Ensanchar tampoco serviría — daría `BARTOLOME ARTURO S/`, que es peor. Hay que recortar, y por eso el paso nuevo corre **después**, para que el ensanche no vuelva a meter la letra.

## Consecuencias

**Medido, sobre el mismo corpus:**

| | antes | después |
|---|---|---|
| spans de `PERSON` en 8 documentos | 451 | **451** |
| spans que terminan antes de una barra | 4 | **0** |
| clave `bartolome arturo s` | 3 ocurrencias, grupo propio | **no existe** |
| clave `bartolome arturo` | 16, todas absorbidas | **19, todas absorbidas** |

No se pierde un solo span: los 3 corregidos pasan a ser `bartolome arturo`, y como ahora terminan justo donde termina la carátula, ADR-117 los absorbe. El grupo espurio desaparece **sin** que desaparezca ninguna cobertura.

**En contra**

- **La regla se justifica con 4 casos**, todos del mismo documento y todos con la misma letra. Es un patrón de carátulas argentinas (`S/`, `c/`), no una propiedad del español.
- **No toca los otros bordes sucios que la medición encontró**: `Amalia Bonetti-`, `Solari-`, `Renner-` siguen pegados a un guion. Ahí el nombre **está completo** y el guion queda afuera del span, así que no hay nada que recortar — pero si un día el modelo se come una letra antes de un guion, esta regla no lo cubre.
- **La causa raíz sigue siendo el modelo**, que etiquetó la `S` como parte de la persona. Esto lo corrige después del hecho.
- **La fusión al 0,889 sigue ahí.** Este ADR saca el caso que la usaba, no la fragilidad: cualquier otro par de claves que difiera en un carácter final se sigue uniendo o separando por una milésima. No hay medición que diga que 0,88 esté mal, y por eso no se toca.

**Lo que no toca**: `aggregateTokensToSpans`, el encaje de bordes de ADR-111, la clave de ADR-118, el título de las corridas en caja alta de ADR-088 §2, ni ningún contrato.

## Qué hay que cubrir con tests

- La letra del separador se cae y la clave queda igual a la del nombre — que es lo que evita el grupo espurio.
- Una inicial de verdad (`Juan P. García`) **se conserva**: es la mitad de la condición que mira la barra.
- `Quilmes/ La Plata` no pierde la `s`: es la otra mitad, la que exige que la letra sea un token suelto.
- Un span que era solo la letra desaparece.
