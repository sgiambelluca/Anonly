<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/React_Client.md,architecture/07_Performance_Strategy.md,adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md,adr/ADR-094-Lo-Que-El-Detector-Duda-No-Se-Tira-En-Silencio.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md | audiencia=humanos+IA | fase=11 -->

# ADR-126 — Detectar nombres no es una preferencia

- **Estado**: Accepted
- **Fecha**: 2026-09-03
- **Decidido por**: El humano: *"tiene que estar siempre activo, no que el usuario lo active a elección si no sabe qué hace"*. Y, sobre el intento de conservar la salida degradada: *"no me sirve escanear el documento entero SALVO nombres"*.
- **Relacionado con**: ADR-038 §7 (el flujo de settings que dispara `reanalyze`), ADR-094 (lo que el detector no llegó a revisar se avisa, no se esconde), ADR-125 (que acababa de poner Configuración en la pantalla de carga)
- **Parte de**: Hito 11

## Contexto

### 1. Un control que solo puede empeorar el resultado

`SettingsDialog` tenía, bajo "Qué se detecta", un checkbox: **"Detectar nombres de personas y organizaciones"**. Encendido por default, y apagarlo desactiva el detector de nombres.

El problema no es la etiqueta —es buena: describe el efecto y no la etapa (ADR-087 §4)— sino que la decisión no es del usuario. Las dos posiciones del control no son un gusto: una detecta nombres y la otra no. Apagarlo no cambia *cómo* se ve el documento, cambia **cuántos datos personales quedan a la vista en el PDF exportado**, y lo hace en silencio: el árbol simplemente no muestra la categoría "Personas", que es indistinguible de un documento que no tiene nombres.

Es la misma asimetría con la que el repo ya decide en otra parte (`Grouping_Engine.md` §13 caso 40: *"de más grupos no sale ninguna fuga; de menos, el documento afirma que dos entidades distintas son la misma"*). Acá es más directa: de la detección encendida sale, como mucho, un falso positivo que el usuario deshabilita en un click; de la detección apagada sale un nombre sin censurar.

### 2. Y la "salida degradada" del fallo era el mismo error, más grande

`nerEnabled` no vivía solo en ese checkbox. Cuando el modelo no carga, `PIPELINE_FAILED` llega con `NER_MODEL_MISSING` y el banner ofrecía **"Seguir sin detectar nombres"**: reanalizar con el detector apagado y seguir adelante.

Ese botón parecía una recuperación y era una trampa. Lo que produce es un documento que llega a "Listo", se exporta como anonimizado, y tiene los identificadores tapados con **todos los nombres intactos** — la categoría más sensible de un expediente. No es una versión degradada del resultado: es un resultado equivocado con cara de éxito, que es el modo de falla que este repo persigue documento por documento (ADR-094: *"el peor modo de falla que existe: silencioso y con cara de éxito. El usuario exporta creyendo que anonimizó"*).

**Un análisis al que le faltan justamente los nombres no sirve.** Que el detector principal no cargue es un fallo, y un fallo se reintenta; no se continúa.

## Decisión

### 1. Se retira el control de `SettingsDialog`

Para el usuario, la detección de nombres está siempre activa y no tiene perilla. El diálogo queda con Idioma, Rendimiento e Idiomas del documento — los tres son elecciones legítimas y ninguna puede dejar datos sin detectar.

### 2. `NER_MODEL_MISSING` deja de ofrecer continuar

Se retira el botón "Seguir sin detectar nombres". El banner queda con el mensaje y "Cerrar documento", y el mensaje dice qué pasó y qué hacer: *"No se pudo cargar el detector de nombres, así que el documento no se puede analizar completo. Recargá la página y probá de nuevo."*

No se toca ADR-094: un detector que **corrió y falló en algunas páginas** sigue terminando el análisis con el aviso de incompleto, porque ahí sí hay resultado parcial y el usuario está advertido antes de exportar. Lo que se retira es la otra cosa: ofrecer de arranque un análisis al que le falta entera la categoría más sensible.

### 3. `nerEnabled` sobrevive **solo** como canal de override de los tests

Ningún camino de producto lo escribe: no hay control en el formulario y no hay botón de degradar. Sigue en `settings.store` con default `true` y sigue mapeando a `ner.enabled` (`React_Client.md` §3.7), y `load()` lo lee si está presente en `localStorage`.

Eso es lo único que lo mantiene vivo, y es deliberado: es el canal por el que los escenarios E2E que no necesitan el detector de nombres lo apagan antes del arranque (`tests/e2e/support/settingsOverride.ts`), en vez de descargar y correr el modelo en cada spec. Queda documentado como lo que es —un override de test, no una preferencia—, y `persist()` **no** lo escribe: nada de la app puede dejarlo apagado para la próxima sesión.

La alternativa era sacarlo del todo. Se descartó porque no compra nada de producto —ya no hay forma de llegar a él desde la UI— y cuesta un escenario documentado (el 8) más seis specs corriendo el modelo de nombres sin necesitarlo.

## Consecuencias

- El diálogo pierde el único campo con el que un usuario podía empeorar su propio resultado sin enterarse.
- Si el modelo no carga, la herramienta lo dice y no entrega nada. Es más honesto que entregar un documento a medias que se ve terminado.

**En contra**

- **Un fallo de carga del modelo ahora bloquea el documento por completo**, incluso para alguien que solo quería tapar identificadores. Es exactamente el punto: esa persona no puede distinguir "no había nombres" de "no se buscaron", y el archivo que se lleva es el mismo en los dos casos.
- **Ya no hay forma de activar el detector de nombres en runtime desde la UI**, porque ya no hay forma de desactivarlo. El escenario E2E 9 (`07_Performance_Strategy.md` §11.3) usaba ese camino como disparador; su valor real —*"reanaliza preservando las ediciones previas del usuario"*— se conserva cambiando el disparador a **Idiomas del documento**, que es el otro setting que dispara `reanalyze` con confirmación (ADR-038 §7). Lo que se pierde es la mitad "se descarga el modelo en runtime", que ya no describe ningún camino de usuario.
- **El E2E de ADR-125 pierde su control observable.** Probaba que la configuración elegida antes del escaneo llega al análisis apagando el detector de nombres y contando que no apareciera la categoría "Personas". De los settings que quedan, ninguno cambia el árbol de un PDF con texto. Pasa a afirmar lo que sigue siendo exacto y falsable: que guardar un cambio de `EngineConfig` sin documento abierto **reemplaza la instancia del core** (`window.__anonlyCore`, expuesta en DEV), y que un cambio que no toca el `EngineConfig` —el idioma de la interfaz— **no** la reemplaza. Es la contracara exacta de `sameEngineConfigOverrides`.

**Lo que no toca**: `EngineConfig.ner.enabled` (contrato del Core, intacto), el mapeo de `React_Client.md` §3.7, el flujo de `reanalyze` con documento abierto, el aviso de análisis incompleto de ADR-094, ni el escenario 8 (que sigue arrancando sin el detector por el canal de override).

## Qué hay que cubrir con tests

- `persist()` **no** escribe `nerEnabled`; `load()` **sí** lo lee si está presente. Son las dos mitades de §3, y de la segunda dependen seis specs E2E — si se cae, la suite sigue en verde y se vuelve mucho más lenta sin que nada avise.
- El mensaje de `NER_MODEL_MISSING` dice que hay que reintentar y **no** contiene ninguna variante de "podés seguir sin". Es la línea que este ADR retira, y la que más barato sería volver a agregar sin pensarlo.
- E2E: las ediciones del usuario sobreviven un `reanalyze` disparado desde Idiomas del documento (escenario 9 reencuadrado).
