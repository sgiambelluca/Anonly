<!-- CONTEXT: scope=roadmap-1.1.1 | dependencias=roadmap/Roadmap_1.x.md,roadmap/Plan_1.1.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-236-La-1.1.1-Trae-Veinte-Paises-Y-La-Interfaz-En-Ingles.md,adr/ADR-217-Una-Direccion-Con-Palabra-Clave-Es-Un-Patron.md,core/Regex_Engine.md,core/Grouping_Engine.md,core/Contracts.md,ui/React_Client.md,ui/Components.md,ui/UX_Guidelines.md | audiencia=humanos+IA | fase=1.1.1 -->

# Plan de la 1.1.1 — Veinte países y la interfaz en inglés

> Cómo se arma la 1.1.1: diecinueve catálogos de país en seis tandas, cuatro
> tipos base nuevos, la pantalla de país del primer arranque y la interfaz
> en inglés. Las decisiones están en ADR-236; el mecanismo de los catálogos,
> en ADR-221.

**En pausa y sin versión desde el 2026-11-23** (ADR-237). El mantenedor
pone el esfuerzo en los otros formatos de documento, que pasan a ser la 1.2
(`Roadmap_1.x.md` §5). Este plan conserva el número viejo en el nombre para
no romper enlaces: donde dice «la 1.1.1», se lee «la versión de los
países». Se retoma por §6. Lo que cambia al retomarlo: el número se decide
entonces, y la pantalla de país la ve solo quien instala de cero, no quien
actualiza desde cualquier versión anterior (ADR-237 §2).

**Estado (2026-11-22):** ADR-236 aceptado. La tanda 1 tiene la
investigación y dos mediciones, pero **su tabla final todavía no está
aprobada** (§6). Nada implementado en los motores.

- Investigación:
  [`Paises_Tanda1_Investigacion_2026-11-22.md`](./mediciones/regex/Paises_Tanda1_Investigacion_2026-11-22.md).
- Primera medición:
  [`Paises_Tanda1_Medicion_2026-11-22.md`](./mediciones/regex/Paises_Tanda1_Medicion_2026-11-22.md).
- Segunda medición, con las decisiones de §5 aplicadas y la tabla final
  propuesta:
  [`Paises_Tanda1_Medicion2_2026-11-22.md`](./mediciones/regex/Paises_Tanda1_Medicion2_2026-11-22.md).
- Los prototipos y el corpus sintético están en `tests/paises/`. Se corren
  aparte, con `pnpm exec vitest run --config tests/paises/vitest.paises.config.ts`,
  y no entran en `pnpm test`.

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
| U1 | ADR y medición de los universales en español: carátula con dos apellidos, fecha con punto, mes abreviado y direcciones con «Camino», «Ruta» con kilómetro y «c/» (§5) | `regex-engine` | P0; se mide contra la línea de base argentina |
| T1 a T6 | Las seis tandas de §2 | `shared`, `regex-engine`, `grouping-engine` | C1; cada tanda, de su aprobación |
| V | Verificación: línea de base de calidad con Argentina y sin formatos propios, un E2E con un país de cada tanda, un E2E con la interfaz en inglés y la suite pesada | `tests/` | Todo lo anterior |

- **Un solo sub-agente activo a la vez**, como en todas las versiones. Los
  frentes de `react-client` (P3, I1 e I2) se ordenan entre sí para no tocar
  los mismos archivos: I1 va primero, porque mueve todos los textos.
- Los informes de cada tanda van en `docs/roadmap/mediciones/regex/`, con
  IDs neutros y agregados.

## 5. Decisiones de la tanda 1

Del mantenedor, el 2026-11-22, sobre la primera pasada de la investigación:

- **El RUT de Chile va bajo `DNI`**, con el nombre «RUT». El tipo tributario
  queda sin formatos en Chile (ADR-221 §3).
- **Las formas sin verificador o de menor precisión entran a la medición**:
  el RUT sin guion, la CI uruguaya sin verificador y las cédulas de Paraguay
  y Bolivia. El mantenedor aprueba cuáles quedan, forma por forma, con lo
  que detectan y lo que tapan de más.
- **Un tipo sin formato confirmado por una fuente queda sin formato en ese
  país.** El informe lo dice, y el usuario lo puede crear como formato
  propio. No se escribe un formato genérico sin fuente.
- **Las patentes que ya no se emiten entran si siguen circulando**, y se
  miden igual que las vigentes.
- **La cédula y el RUT de Uruguay usan el verificador de terceros, con
  respaldo.** Uruguay no publica el algoritmo, y la DGI declaró reservado el
  del RUT. Se usa el que circula (python-stdnum), y el informe dice que no
  tiene fuente oficial. Para que un error del algoritmo no deje un dato sin
  tapar:
  - **escrito con puntos y guion** (`1.234.567-2`), se tapa siempre, pase o
    no el verificador;
  - **escrito solo con dígitos** (`12345672`), se tapa solo si pasa el
    verificador.
- **Sobre la medición de la tanda 1**
  ([`Paises_Tanda1_Medicion_2026-11-22.md`](./mediciones/regex/Paises_Tanda1_Medicion_2026-11-22.md)):
  - **Las patentes y el pasaporte que tapan de más exigen una palabra
    antes** («patente», «placa», «chapa», «dominio» o «pasaporte»). Son la
    moto chilena de 3 letras y 2 dígitos, las de Paraguay y Bolivia con
    falsos positivos y el pasaporte argentino. Las que dieron 0 falsos
    positivos no cambian.
  - **La cédula de Paraguay y la de Uruguay sin verificador se tapan solo con
    una palabra antes** («C.I.», «cédula» o similares). «Nº» sale de la lista
    de contexto, también en Bolivia: tapaba números de factura.
  - **La cédula uruguaya solo con dígitos entra con su verificador**, como ya
    estaba decidido. **El RUT chileno sin guion entra solo con «RUT» o «RUN»
    antes.** Esa forma con contexto cubre también el RUT con el verificador
    mal tipeado.
  - **Los universales en español se mejoran con un ADR propio dentro de la
    1.1.1**, para todos los países de habla hispana, incluida Argentina: la
    carátula con dos apellidos, la fecha con punto, el mes abreviado y las
    direcciones con «Camino», «Ruta» con kilómetro y «c/». Solo pueden tapar
    más, se miden contra la línea de base argentina y las notas de la
    versión lo dicen (frente U1).
  - **Las propuestas técnicas del planificador**, aprobadas por el
    mantenedor el mismo día:
    - el RUC de Paraguay usa el algoritmo, que reproduce el ejemplo de la
      DNIT; los dos ejemplos del informe estaban mal calculados;
    - Chile: Santiago es `2` más 8 cifras, agrupadas 1+3+4. El planificador
      escribió «prefijo celular `6[13457]`», pero esos son códigos de zona de
      fijos, y la segunda medición los dejó ahí;
    - Paraguay: el fijo exige prefijo de país o el `0` inicial;
    - una cédula de 6 dígitos no empieza justo después de un dígito y un
      punto: el número entero lo toma la forma de 8 dígitos;
    - la patente chilena de 4 letras y 2 dígitos usa la lista de letras sin
      fuente con respaldo: con las letras de la lista se tapa siempre, y con
      otras, solo si la precede una palabra de patente. Se suma la grafía con
      puntos (`BC.DF.12`);
    - el NIT de Bolivia acepta hasta 3 palabras entre «NIT» y el número, en
      el mismo renglón;
    - los teléfonos de 8 dígitos sin separadores de Uruguay y Bolivia no
      entran;
    - el celular chileno sin prefijo entra solo con una palabra antes;
    - cada formato tiene como máximo 5 palabras de contexto
      (`FORMAT_MAX_CONTEXT`, ADR-220);
    - el complemento de la CI boliviana no tiene fuente y no entra. La
      segunda medición corrigió lo que se esperaba: la guarda de corrida de
      ADR-075 §2 descarta el número, así que **una CI con complemento
      (`1234567-1A`) queda entera a la vista**, no tapada sin el
      complemento. Vuelve al mantenedor (§6).
- **Las patentes nuevas de Chile no entran en la 1.1.1.** Son las de 5
  letras y 1 dígito para autos, y 4 letras y 1 dígito para motos, del DS 114
  de 2025 del MTT. Rigen recién cuando el Registro Civil declare agotadas las
  combinaciones actuales, y todavía no se emite ninguna. Se suman cuando se
  emitan.

## 6. Pendiente de la tanda 1, al retomar

La segunda medición bajó los falsos positivos del corpus normal de 57 a 0
sobre el corpus anterior, pero el contexto obligatorio tiene un costo que el
mantenedor no vio todavía:

- **El recall cae mucho donde se exigió una palabra antes.** Sobre el corpus
  anterior:
  - las patentes con contexto quedan entre 0 y 33 %, y el pasaporte
    argentino en 19 %, porque el corpus las escribe sin la palabra;
  - la cédula de Paraguay queda en 41 %;
  - el RUT chileno sin guion, en 43 %.

  Una patente o una cédula sin palabra antes queda a la vista. El mantenedor
  tiene que confirmar el canje, forma por forma, o elegir otra salida.
- **La CI boliviana con complemento queda entera a la vista** (§5). Es una
  fuga, no un tapado parcial.
- **Ruido que sigue** sobre 2000 números al azar: el fijo chileno, 36 % de
  los números de 9 dígitos pegados (falta decidir si sin prefijo exige
  separador); `uy:ci-digitos`, 10 a 11 %; `cl:rut` y `py:ruc`, cerca de 9 %.
  `uy:ci` con puntos y guion se tapa siempre, por decisión (§5).
- **Dudas de la segunda medición** (detalle en su informe):
  - «Matrícula» como quinta palabra de contexto de la patente en Uruguay:
    sin ella, `uy:plate` no tapa ninguna;
  - el relleno de hasta 3 palabras del NIT y la guarda «no después de dígito
    y punto» no tienen pieza en ADR-220. En un formato base `control` se
    pueden escribir en código, pero un formato `structure` no los puede
    expresar;
  - Uruguay y Paraguay no tienen forma de 8 dígitos con puntos: sin
    Argentina activa, `12.345.678` queda sin tapar;
  - sin «Nº» en el contexto, `C.I. N° 1.234.567` ya no se tapa;
  - siguen sin decidir `uy:ci-guion`, `uy:ci-guion-sc` y
    `cl:phone-mobile-parentesis`;
  - formas que con contexto se podrían fusionar en una con variantes.
- **Después de la aprobación:** el planificador escribe las filas en los
  specs (§2, paso 4), con el contrato de los cuatro tipos nuevos (frente C1)
  primero.
- **Lo demás que sigue abierto:** los frentes P1 (el rastro de una 1.1.0 y
  el diseño de la pantalla de país), U1 (el ADR de los universales), I1 (el
  catálogo de textos) y la investigación de la tanda 2.

## 7. Para decidir al llegar

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
