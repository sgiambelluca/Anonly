<!-- CONTEXT: scope=adr | dependencias=core/Regex_Engine.md,ai/AI_Development_Guide.md,adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md,adr/ADR-021-Engines-Inline-Hasta-Hito9.md | audiencia=humanos+IA | fase=5 -->

# ADR-022 — Regex Engine: límites de palabra en el patrón Phone (AR mobile)

- **Estado**: Accepted
- **Fecha**: 2026-07-10
- **Decidido por**: Revisión del Hito 4 (regex-engine) — REJECTED del agente revisor, confirmado y resuelto con el humano
- **Relacionado con**: ADR-020 §12 (precedente de excepción documentada a R-21 dentro del mismo PR)

## Contexto

Durante la implementación del Hito 4 (`packages/anonymization-core/regex-engine`), el implementador detectó que el patrón "Phone (AR mobile)" de `core/Regex_Engine.md`, tabla "Patrones default (especificación exacta)", es el único de los 11 patrones de esa tabla **sin** límites de palabra (`\b`) en los extremos:

```
(?:\+?54)?[\s-]?\d{2}[\s-]?\d{4}[\s-]?\d{4}
```

Los otros 10 patrones de la misma tabla (DNI, CUIT, Phone landline, Email, IBAN, CreditCard, Date, License, Plate vieja, Plate Mercosur) sí anclan ambos extremos con `\b`.

Tomado literalmente, este patrón matchea cualquier ventana de 10 dígitos dentro de una corrida de dígitos más larga, sin exigir que esa ventana empiece o termine en un borde real de token. Esto rompe el caso límite 3 del propio spec (§13/§14, test `DNI with and without dots normalizes to same`), que es un test **obligatorio** exigido por el mismo documento:

Input: `"34.567.891 34567891"` (dos DNI, uno con puntos y otro sin, que deben normalizar igual).

Con el patrón literal, el motor encuentra el match espurio `"91 34567891"` (11 caracteres: los dos últimos dígitos del primer DNI + el espacio + los 8 dígitos del segundo DNI). Por la regla de resolución de overlaps del caso límite 10 (§13, "el motor prioriza el match más largo en el mismo span"), este match de 11 caracteres es más largo que cualquiera de los dos DNI individuales (10 y 8 caracteres) y se solapa con ambos, así que gana la resolución de overlaps sobre los dos — el resultado neto es 0 DNI detectados y 1 teléfono inexistente en el documento.

Se verificó empíricamente (revisor, corrida real de la lógica de overlap) que:
- El **caso 3** sí se rompe con el patrón literal (sin `\b`).
- El **caso 10** (DNI dentro de un CUIT) **no** se ve afectado ni con `\b` ni sin él: el CUIT (más largo, con checksum válido) gana la resolución de overlaps en ambas variantes.

El implementador, en vez de detenerse a reportar esta contradicción interna del spec, agregó `\b` al patrón por su cuenta y documentó la desviación en el código pidiendo confirmación humana. Por `R-21` (los specs de motor no se editan desde un PR de implementación) y `R-2`/`R-19` (contrato antes que código), esa decisión no le correspondía a un PR de implementación sin ADR previo — el fix en sí es correcto, pero requiere este ADR para tener autoridad.

## Decisión

Se corrige el patrón "Phone (AR mobile)" en `core/Regex_Engine.md` agregando límites de palabra alrededor del grupo obligatorio de dígitos, manteniendo intacto el prefijo opcional `+54`:

```
(?:\+?54)?[\s-]?\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b
```

Esto alinea la fila "Phone (AR mobile)" con el criterio ya usado por los otros 10 patrones de la misma tabla (incluida la fila inmediatamente inferior, "Phone (AR landline)", que ya usaba `\b`). No hay ninguna nota en el spec que explique una asimetría deliberada; se interpreta como una omisión de transcripción, no una decisión de diseño.

La implementación de `packages/anonymization-core/regex-engine/src/patterns/default-ar.ts` (patrón `phone-mobile-ar`) ya usa el patrón corregido — este ADR le da autoridad retroactiva. El comentario `DESVIACIÓN DOCUMENTADA` del código se reemplaza por una referencia directa a este ADR.

Excepción consciente a R-1/R-21 (mismo tipo que ADR-020 §12, alcance mínimo): este ADR, la actualización de `core/Regex_Engine.md` y el código de `regex-engine` se integran en el mismo PR/rama (`feat/regex-engine-hito-4`), autorizado explícitamente por el humano — separar la corrección del spec (una fila de una tabla) del código que ya la implementa no aporta aislamiento real y sí fricción de coordinación innecesaria para un cambio de este tamaño.

`core/Regex_Engine.md` pasa de versión `1.0.0` a `1.0.1` (fix, no cambio de alcance funcional) y su fecha de última actualización a 2026-07-10.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Mantener el patrón literal sin `\b` | Rompe el caso límite 3, que es un test obligatorio exigido por el propio spec (§14). No es una opción viable. |
| Quitar `\b` de los otros 10 patrones para "unificar" en la otra dirección | Reproduciría el mismo problema de matches espurios cruzando tokens en todos los patrones de la tabla, no solo en uno. Mucho peor blast radius por el mismo problema. |
| Cambiar la heurística de resolución de overlaps (§13 caso 10) en vez de anclar el patrón | El caso 10 (CUIT gana sobre DNI) ya funciona correctamente con la heurística actual ("match más largo gana"); cambiarla para evitar un problema que en realidad está en un patrón individual afectaría un contrato que hoy no está roto, sin necesidad. |
| Agregar `\b` solo en un extremo (inicio o fin) | Asimétrico y sin justificación: un match que empieza en un borde real pero termina en medio de una corrida de dígitos más larga (o viceversa) es tan espurio como el caso documentado. Los otros 10 patrones anclan ambos extremos; no hay razón para que este sea distinto. |

## Consecuencias

**Positivas**: el caso límite 3 (test obligatorio del spec) pasa determinísticamente; el patrón queda consistente con el resto de la tabla; no se pierde capacidad de detectar teléfonos reales (un teléfono AR genuino en un documento está delimitado por espacios/puntuación, no pegado a otra corrida de dígitos).

**Negativas**: cambio de contrato público (tabla de patrones default) decidido después de que el código ya existía, en vez de antes — desviación puntual de R-19, mitigada por ser una excepción documentada y acotada (una fila de una tabla), no un patrón que se repita sin autorización.

**Neutras**: el caso límite 10 (overlap DNI/CUIT) queda sin cambios, confirmado empíricamente.

## Validación

- `edge.test.ts` (`regex-engine`), caso 3: `"DNI with and without dots normalizes to same"` — pasa con el patrón corregido.
- `edge.test.ts`, caso 10: `"DNI inside CUIT only emits CUIT"` — pasa sin cambios con el patrón corregido (confirma que este caso era y sigue siendo independiente del fix).
- Gates completos verdes: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.
- Cobertura `regex-engine/src` ≥ 85% líneas (medida: 99.61%).

## Referencias

- `core/Regex_Engine.md` §13 (casos límite 3 y 10), tabla "Patrones default (especificación exacta)" — versión 1.0.1
- `ai/AI_Development_Guide.md` R-1, R-2, R-19, R-21
- `adr/ADR-020-PdfEngine-Word-Granularity-Hardening.md` §12 (precedente de excepción documentada)
- `adr/ADR-021-Engines-Inline-Hasta-Hito9.md` (contexto de motores del Hito 4 en adelante)
