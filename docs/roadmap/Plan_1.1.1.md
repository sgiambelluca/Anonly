<!-- CONTEXT: scope=roadmap-1.1.1 | dependencias=roadmap/Roadmap_1.x.md,roadmap/Plan_1.1.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-236-La-1.1.1-Trae-Veinte-Paises-Y-La-Interfaz-En-Ingles.md,adr/ADR-217-Una-Direccion-Con-Palabra-Clave-Es-Un-Patron.md,core/Regex_Engine.md,core/Grouping_Engine.md,core/Contracts.md,ui/React_Client.md,ui/Components.md,ui/UX_Guidelines.md | audiencia=humanos+IA | fase=1.1.1 -->

# Plan de la 1.1.1 — Veinte países y la interfaz en inglés

> Cómo se arma la 1.1.1: diecinueve catálogos de país en seis tandas, cuatro
> tipos base nuevos, la pantalla de país del primer arranque y la interfaz
> en inglés. Las decisiones están en ADR-236; el mecanismo de los catálogos,
> en ADR-221.

**Estado (2026-11-22):** ADR-236 aceptado. Arranca la investigación de la
tanda 1. Nada implementado.

## 1. Qué trae

- Los catálogos de Bolivia, Chile, Colombia, Costa Rica, Cuba, Ecuador, El
  Salvador, España, Estados Unidos, Guatemala, Honduras, México, Nicaragua,
  Panamá, Paraguay, Perú, República Dominicana, Uruguay y Venezuela: sus
  formatos, los nombres de sus tipos, su escalera de etiquetas y sus
  generadores sintéticos (ADR-221 §2 a §4).
- Cuatro tipos base nuevos: seguridad social, pasaporte, licencia de
  conducir y cuenta bancaria. En Argentina, la cuenta bancaria es el CBU y
  el CVU (ADR-236 §3).
- Las variantes en inglés de las fechas, la dirección y la carátula, en el
  catálogo de Estados Unidos, y una acción que las suma con otro país activo
  (ADR-236 §4).
- El selector de país y «agregar desde otro país» en «Formatos de
  detección», que en la 1.1 están ocultos (ADR-221 §7).
- La pantalla de país del primer arranque, con la región del sistema
  preseleccionada (ADR-236 §5).
- La interfaz en inglés, con el selector de idioma visible (ADR-236 §7).

## 2. Las tandas

| Tanda | Países | Códigos |
|---|---|---|
| 1 | Chile, Uruguay, Paraguay y Bolivia, más los tipos nuevos de Argentina | `CL`, `UY`, `PY`, `BO` (y `AR`) |
| 2 | Perú, Ecuador, Colombia y Venezuela | `PE`, `EC`, `CO`, `VE` |
| 3 | México, Guatemala, El Salvador, Honduras y Nicaragua | `MX`, `GT`, `SV`, `HN`, `NI` |
| 4 | Costa Rica, Panamá, Cuba y República Dominicana | `CR`, `PA`, `CU`, `DO` |
| 5 | España | `ES` |
| 6 | Estados Unidos, con sus variantes en inglés | `US` |

Cada tanda pasa por los mismos pasos, en orden:

1. **Investigación** (sin código). Un subagente arma, por país, la tabla de
   §3 con sus fuentes. No edita `docs/` ni el código: entrega su informe al
   planificador.
2. **Corpus sintético y medición.** Un corpus por país con textos que
   imitan documentos de allá, y la medición de ADR-221 §6: qué se detecta,
   qué se tapa de más, cómo se comportan los universales (ADR-236 §4) y si
   cambia algo sobre el corpus argentino. Se mide con prototipos fuera de
   los motores, como con ADR-217.
3. **Aprobación del mantenedor** de las tablas de la tanda, con su medición.
4. **Specs.** El planificador escribe las filas en `Regex_Engine.md`
   (catálogo, definiciones y casos), en `Grouping_Engine.md` (etiquetas), en
   el sintetizador de `@anonly/shared` y los códigos en `Contracts.md`
   (`CountryCode`).
5. **Implementación**, un commit por módulo: `shared` (contrato y
   generadores), `regex-engine` y `grouping-engine`.

La investigación de una tanda puede ir mientras se implementa la anterior.
El revisor corre por tanda, cuando están sus módulos.

**La tanda 6 es la más grande.** Tiene formatos que cambian por estado
(licencia de conducir y patente), las cuatro variantes en inglés, el
reemplazo de la fecha de día y mes, y el caso de convivencia de las dos
fechas (ADR-236 §4).

## 3. La tabla de cada país

Por cada formato:

- su id (`<código>:<nombre>`), su nombre en el país y el tipo base al que va;
- si es `structure` o `control`, y cuál es su control (por ejemplo, el
  dígito verificador);
- su definición: las piezas del generador si es `structure`, o el patrón y
  el control si es `control`;
- su `maskFormat` y su normalizador;
- ejemplos que debe detectar y ejemplos que no;
- la fuente: la norma o el organismo que fija el formato.

Por cada tipo base del país, incluidos los cuatro nuevos:

- su nombre en la interfaz y su escalera de etiquetas (ADR-057). Si el tipo
  tiene varios formatos, un solo nombre que sirva para todos (ADR-236 §3);
- su generador sintético, que pase el control del formato principal.

Y aparte:

- **los identificadores que no entran en ninguno de los nueve tipos que
  dependen del país**, con el nombre que tienen en el país (ADR-236 §3);
- lo que la investigación no pudo confirmar, dicho como tal.

## 4. Frentes

| Frente | Qué | Módulo | Depende de |
|---|---|---|---|
| P0 | ADR-236 y estos docs | `docs/` | — |
| C1 | Los cuatro tipos nuevos en `EntityType`, con su nombre y su escalera de etiquetas en Argentina | `shared` (contrato), y después `grouping-engine` y `react-client` | P0 y los nombres aprobados en la tanda 1 |
| P1 | Probar qué rastro deja una 1.1.0 sin nada guardado (ADR-236 §5), y el diseño de la pantalla de país con el mantenedor | planificador | P0 |
| P2 | La región del sistema en `window.anonlyDevice` | `desktop-shell` | P1 |
| P3 | La pantalla de país del primer arranque, mostrar el selector y «agregar desde otro país», y la acción que suma las variantes en inglés | `react-client` | P1, P2 y la tanda 1; la acción, de la tanda 6 |
| I1 | El catálogo de textos por idioma: sacar todos los textos de la interfaz, sin cambiar ninguno en español | `react-client` | P0 |
| I2 | Los textos en inglés, aprobados por el mantenedor, y el selector de idioma visible | `react-client` | I1 |
| T1 a T6 | Las seis tandas de §2 | `shared`, `regex-engine`, `grouping-engine` | C1; cada tanda, de su aprobación |
| V | Verificación: línea de base de calidad con Argentina y sin formatos propios, un E2E con un país de cada tanda, un E2E con la interfaz en inglés y la suite pesada | `tests/` | Todo lo anterior |

- **Un solo sub-agente activo a la vez**, como en todas las versiones. Los
  frentes de `react-client` (P3, I1 e I2) se ordenan entre sí para no tocar
  los mismos archivos: I1 va primero, porque mueve todos los textos.
- Los informes de cada tanda van en `docs/roadmap/mediciones/regex/`, con
  IDs neutros y agregados.

## 5. Para decidir al llegar

- Las tablas de cada tanda (§2, paso 3).
- El diseño de la pantalla de país y de la acción que suma las variantes en
  inglés (P1, P3).
- Qué hacer si una 1.1.0 sin nada guardado no deja rastro (ADR-236 §5).
- Si un formato universal falla con algún país hispanohablante (ADR-236 §4).
- Si la pantalla del primer arranque pregunta también el idioma de la
  interfaz.
- Si los textos que la exportación escribe en el PDF, como los de la hoja
  de referencia, siguen el idioma de la interfaz.
- Los textos en inglés (I2).
