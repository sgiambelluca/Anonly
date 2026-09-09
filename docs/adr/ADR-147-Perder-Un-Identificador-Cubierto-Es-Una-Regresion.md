<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,roadmap/MVP.md,adr/ADR-095-La-Regla-De-Matcheo-Es-La-Metrica.md,adr/ADR-096-Los-Patrones-Cubren-Como-Se-Escribe-El-Dato.md,tests/fixtures/README.md | audiencia=humanos+IA | fase=11 -->

# ADR-147 — Perder un identificador cubierto es una regresión

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-10 del plan de campaña de hardening (§2, §8).
- **Relacionado con**: ADR-095 (la regla de matcheo es la métrica; el evaluador informativo), ADR-096 (los patrones cubren cómo se escribe el dato), `MVP.md` §5 (los objetivos absolutos de producto)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Hoy nada bloquea una regresión de detección

`pnpm test:quality` corre el dataset de referencia y **reporta**: sale distinto
de cero solo si el evaluador no pudo correr, por decisión explícita de ADR-095
§6 ("los umbrales del gate se deciden con estos números a la vista, no antes").
Corre además **sin NER** (el modelo se resuelve contra una ruta de servidor que
en Node no existe).

`pnpm test:measure` sí corre con NER, en un navegador real, guarda en `.measure/`
y tampoco impone umbrales. En la medición actual un documento que falla se
reporta y la corrida sigue.

O sea: se puede perder la detección de un identificador que antes se tapaba y
todos los gates siguen verdes.

### 2. Los números que circulan son historia, no estado

El 77 % de Regex viene de un diagnóstico **anterior** a correcciones, y hay
mediciones posteriores 61/61. El 12/17 de NER también es histórico. Ninguno
puede convertirse en umbral sin volver a medir: fijar un gate contra un número
viejo es fijarlo contra un documento distinto del que hoy corre.

### 3. Una cobertura atribuida a un detector no aísla a ese detector

La evaluación compara contra un truth por categorías. Cuando Regex y NER corren
juntos, la cobertura del conjunto esperado para uno **no** demuestra causalidad
sobre ese motor. La distinción se mantiene en el reporte; no se convierte en una
afirmación de recall por motor que la medición no sostiene.

## Decisión

### 1. La baseline es un archivo revisable, no `.measure/`

`tests/quality/baselines/reference-v1.json`, versionado y revisado como
cualquier otro cambio. Contiene:

- `schemaVersion`;
- **identidad**: hash del corpus, runtime (motor y versión), `modelId` y hash
  del modelo/lock de assets, configuración efectiva, commit;
- **resultados por documento y por entidad**, en **conteos enteros** — no
  porcentajes redondeados: un porcentaje no permite reconstruir qué se perdió.

No se versiona `.measure/` completo: es salida cruda de una corrida, con lo que
haya adentro.

### 2. Cada entidad tiene una identidad estable, sin cambiar el formato de los fixtures

`TruthEntity` no tiene `id`, y no hace falta agregárselo a mano en 20 archivos:
la identidad se **deriva** de forma determinista como

```
<documentId>:<pageIndex>:<entityType>:<valor normalizado>#<ordinal>
```

donde el ordinal desempata entidades idénticas dentro del mismo documento, por
orden de aparición en el truth. Es reproducible, no toca el schema y hace que
"esta entidad se perdió" sea una afirmación sobre una fila concreta y no sobre
un promedio.

### 3. Qué hace fallar al gate

- **Una entidad que la baseline tenía cubierta y ahora no lo está.** Es la regla
  central: perder un identificador previamente protegido es una regresión, sin
  importar qué pasó con el porcentaje global.
- Un **falso positivo nuevo** por encima de lo registrado, revisado uno por uno
  y no por diferencia de porcentaje.
- Un **documento faltante**, un documento **fallido**, un timeout, un corpus
  vacío, un modelo ausente, un `NaN` o un conjunto obligatorio incompleto. No se
  saltea el documento ni se reduce el denominador: un denominador más chico
  mejora el porcentaje y esconde la falla.
- Un **denominador inesperado**: si cambió la cantidad de entidades esperadas,
  cambió el corpus, y eso exige rebaseline explícito, no un gate que se acomoda.

Una mejora en un documento **no compensa** una pérdida en otro. La comparación
es por entidad, no agregada.

### 4. Sin tolerancia implícita

El default es **cero tolerancia**: la baseline vale exactamente. Si alguna
métrica resulta tener variabilidad genuina entre corridas idénticas, la
tolerancia se declara acá, por métrica, **con la medición que la justifica**, y
como enmienda a este ADR. Nunca se decide una tolerancia mirando un test rojo.

### 5. Generar un candidato y promoverlo son cosas distintas

Un comando aparte produce `…-candidate.json`. **CI nunca escribe el archivo
esperado.** Promover el candidato a baseline es un cambio deliberado, revisado
como diff, con el motivo escrito. Una baseline que se actualiza sola es un gate
que se apaga solo.

### 6. El runtime es parte de la identidad

Una baseline medida con NER en Node nativo no compara contra una medida con
WASM: hay un factor ~19× en tiempo entre backends, y no hay motivo para asumir
que la salida es idéntica. La baseline registra su runtime y el comparador
**exige que coincida**; el producto hoy es el contenedor de escritorio
(ADR-130), así que la baseline obligatoria se mide sobre Chromium/WASM.

### 7. Corpus corto y corpus completo, con sus nombres

Si el presupuesto de tiempo por PR exige un subconjunto, se declara cuál es y se
lo llama **corpus corto**. El completo corre programado y **antes de cada
release**. Llamar "corpus completo" al corto es la forma más barata de tener un
gate que no mide.

### 8. El gate no reemplaza los objetivos de producto

`MVP.md` §5 fija recall/precisión absolutos. Este gate solo dice "no empeoró".
Una baseline mediocre conservada intacta **cumple este gate y no cumple el
producto**; los dos se reportan por separado.

### 9. El comparador tiene sus propios tests

Puro, sin I/O, testeado con datos sintéticos: igualdad pasa; entidad cubierta
que se pierde falla; documento faltante falla; precisión peor falla; corpus o
modelo distinto exige rebaseline; denominador cero se maneja según política y no
produce una división engañosa. Y una prueba de extremo a extremo con resultados
alterados a propósito: el gate tiene que salir en rojo y el check tiene que
frenar el avance de verdad.

## Consecuencias

**A favor**

- Una fuga nueva deja de poder entrar en verde. Es la propiedad que hoy no
  existe.
- La baseline es legible: dice qué entidad, en qué documento y en qué página, no
  un porcentaje.
- El comparador es puro y testeable; el corpus y el modelo quedan atados a los
  números, así que un cambio de assets no puede pasar por mejora.

**En contra**

- **Cero tolerancia produce rojos legítimos** cuando un cambio mejora en general
  y pierde una entidad puntual. Es intencional: esa entidad es un dato personal
  concreto en un documento concreto, y la decisión de aceptar su pérdida tiene
  que ser humana y explícita, no un promedio.
- Correr el corpus completo cuesta tiempo; de ahí la división corto/completo,
  que agrega la obligación de no confundirlos.
- Hay que medir **antes** de tocar cualquier detector, y esa primera medición
  bloquea a H-02 y H-08. Es el orden correcto: sin baseline previa, "mejoró" no
  es una afirmación verificable.

**Lo que no toca**: la regla de matcheo de ADR-095 (cobertura completa,
comparación tipada aparte, sugerencias deshabilitadas fuera del recall), el
código de los motores, ni `Contracts.md`.
