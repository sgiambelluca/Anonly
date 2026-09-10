<!-- CONTEXT: scope=adr | dependencias=ui/UX_Guidelines.md,ui/Components.md,ui/React_Client.md,core/Orchestrator.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-150-La-Pantalla-De-Escaneo-Dura-Lo-Que-Dura-El-Escaneo.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md | audiencia=humanos+IA | fase=11 -->

# ADR-152 — La pantalla de escaneo dice en qué página va

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El humano, sobre pruebas con usuarios: con la modalidad anterior manifestaban **inseguridad para tocar entidades o trabajar mientras el documento todavía se estaba escaneando**. Pidió que la pantalla muestre el avance real, por página y por etapa, en lenguaje de usuario.
- **Relacionado con**: ADR-150 (que le saca el techo a esta pantalla y la vuelve la única cota), ADR-087 §6 (por qué existe), ADR-065 (páginas y regiones de OCR, de donde sale el denominador)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. La pantalla dejó de tener techo, así que ahora tiene que sostenerse sola

ADR-150 retiró el techo de 6 s: la pantalla de escaneo dura lo que dure el
trabajo. Su §4 lo dejó anotado como la condición de esa decisión —"pasa a ser la
única cota, y tiene que ganárselo"— y esta es la parte que la cumple.

Todo lo que se escribió para una pantalla de 1,2 a 6 s hay que revisarlo con esa
luz. La frase rotativa de `scanPhrase.ts` lo dice explícitamente:

> la pantalla dura entre 1,2 y 6 s, así que en el caso normal se ven dos o
> tres — la lista completa nunca se recorre, y no tiene por qué.

En un escaneado largo esa lista de once términos ahora se recorre entera, varias
veces. Una frase que cicla sin cambiar de estado es indistinguible de una app
colgada.

### 2. Lo que hoy se muestra, y el agujero

`resolveScanProgress` da un número **solo en `Detecting`** (páginas detectadas
sobre `document.store.pageCount`). Todo lo demás —abrir, extraer, **OCR**, y la
carga del modelo— es indeterminado: movimiento sin número.

Esa decisión fue correcta cuando se tomó, y su motivo está escrito: antes el
contador corría también en `Extracting` y `OCRing`, llegaba a "10 de 10" **antes
de haber detectado nada** y volvía a "1 de 10" al empezar la detección. Dos
recorridos idénticos del mismo número para dos trabajos distintos.

Pero el problema medido ahí era que los dos contadores **se veían iguales**, no
que hubiera dos. Con un rótulo propio por etapa, dos contadores son dos hechos
distintos, no el mismo hecho contado dos veces.

Y el agujero importa: en un documento escaneado, el OCR es **la etapa larga**, y
es justo la que hoy no dice nada.

### 3. El dato ya existe y llega a la UI

No hay que instrumentar nada nuevo. `runOcrStage` fija
`total = textlessPages.length + ocrRegions.length` y `bumpProgress` lo
incrementa con cada `OCR_PAGE_FINISHED`; `PIPELINE_PROGRESS` lleva
`current`/`total` y `bus-bridge.ts` los deja en `pipeline.store`. Los dos
conjuntos son **disjuntos** y `parsePage` produce **como mucho una región por
página** (ADR-065), así que cada unidad de ese total es exactamente una página:
el contador es honesto sin más aritmética.

## Decisión

### 1. Cada etapa dice qué está haciendo, en su idioma

| Etapa | Qué se muestra | Progreso |
|---|---|---|
| `Importing` / `Extracting` | "Abriendo el documento…" | indeterminado |
| `OCRing` | **"Leyendo el documento: página X de Y"**, con `X` = la última página leída (índice + 1) y `Y` = `document.store.pageCount` | determinado, con la fracción `current/total` de `pipeline.store` |
| `Detecting`, con el modelo cargando | "Preparando el detector…" | indeterminado |
| `Detecting`, detectando | **"Escaneando el documento: página X de Y"**, con `Y` = `document.store.pageCount` | determinado, `X = current` |
| `Grouping` | "Ordenando los resultados…" | indeterminado |

Las frases son de producto y se ajustan en `ui/UX_Guidelines.md`; lo normativo
acá es **qué se puede afirmar en cada etapa y con qué números**. Ninguna nombra
OCR, NER, workers ni modelos: el usuario no tiene por qué saber cómo funciona la
herramienta por debajo para saber si está avanzando.

### 2. El único total que se muestra es el del documento

**Regla dura: `Y` es siempre `document.store.pageCount`, en todas las etapas.**

El motivo es de producto y es el que decide esta sección. En un documento mixto
—digamos 20 páginas, de las cuales 8 son escaneadas— el trabajo de OCR son 8
unidades, y mostrar "3 de 8" sobre un documento que el usuario sabe que tiene 20
páginas no se lee como "3 de las 8 que hay que leer": se lee como **"cargué el
archivo equivocado"**. Un usuario que ve un total que no reconoce cancela el
procesamiento, y cancela justo cuando la aplicación estaba funcionando bien.
Nadie cuenta las páginas que ya pasaron; todo el mundo mira el total y lo
compara con su documento.

De ahí sale la forma de cada etapa:

- En `OCRing`, `X` **no** es cuántas páginas se leyeron: es **cuál** se está
  leyendo, numerada sobre el documento entero. Sale del `pageIndex` de
  `OCR_PAGE_FINISHED` (+1), que la UI ya puede escuchar sin tocar el Core. La
  afirmación "estoy leyendo la página 12 de 20" es literalmente cierta en un
  mixto, y no promete que se vayan a leer las 20.
- La **barra**, en cambio, sí usa `current/total` de `pipeline.store` —la
  fracción real del trabajo de OCR—, así que avanza parejo aunque los números de
  página salten. El total del trabajo gobierna el largo de la barra y **nunca se
  muestra como número**.
- En `Detecting`, `X = current` y `Y` sigue siendo `pageCount` y **no** `total`,
  exactamente por la razón ya medida en ADR-087 §6: durante la carga del modelo
  el store reporta `current/total = 1/1` con el stage ya en `Detecting`. Esa
  trampa es específica de esta etapa y su guarda —no mostrar contador mientras
  el modelo carga— se conserva.

Los dos contadores **no se promedian** en una sola barra: son dos trabajos
distintos y cada uno gobierna la suya mientras está vigente.

### 3. El contador nunca retrocede dentro de una etapa

`current` se acota por los dos lados contra su denominador, como ya hace
`resolveScanProgress` para `Detecting`. Un contador rezagado de la etapa
anterior no puede producir un "12 de 10", y un valor corrupto no puede producir
un negativo.

Que el número **vuelva a empezar al cambiar de etapa** es correcto y esperado:
son dos trabajos distintos, y por eso cada uno lleva su rótulo. Lo que se
prohíbe es que retroceda **sin cambiar el rótulo**.

### 4. La frase rotativa deja de ser el contenido principal

Con etapas que pueden durar minutos, la frase de tipos de dato pasa a ser
acompañamiento de la etapa determinada, nunca su reemplazo. Si la etapa vigente
tiene contador, el contador manda. `SCAN_PHRASE_INTERVAL_MS` y el comentario de
`scanPhrase.ts` que asume una pantalla de 1,2 a 6 s se corrigen con este cambio.

### 5. `Cancelar` sigue siendo la salida, y ahora es parte del contrato de la pantalla

Ya funciona y cancela el procesamiento. Con ADR-150 pasa de ser una comodidad a
ser **la única cota de la espera**, así que su presencia y su efecto quedan
declarados acá: mientras el escaneo corre, `Cancelar` está visible y cancela de
verdad. Sacarlo, deshabilitarlo o volverlo condicional es un cambio de contrato
de esta pantalla, no un detalle de layout.

## Consecuencias

**A favor**

- El usuario ve avance real durante la etapa larga de un documento escaneado,
  que es exactamente donde hoy no hay número y donde la espera es más larga.
- Ataca la causa que las pruebas con usuarios encontraron: la inseguridad venía
  de no saber si el documento estaba listo. Sumado a ADR-150 —que ya no suelta a
  nadie a mitad del escaneo— el usuario entra al panel sabiendo que terminó.
- No agrega instrumentación: los eventos y los campos del store ya existen.

**En contra**

- **Dos contadores en la misma pantalla**, uno después del otro, con
  denominadores distintos. Es el riesgo que la implementación anterior evitó
  borrando el primero; acá se acepta con rótulos que los distinguen, y hay que
  verificarlo con usuarios y no solo con un test.
- La frase rotativa pierde protagonismo, y era parte de la personalidad de la
  pantalla.
- **En un documento mixto los números de página saltan** durante el OCR: va por
  la 3 y después por la 12, porque las del medio ya tenían texto y no se leen.
  Cada afirmación es cierta y el total es el que el usuario reconoce, que es lo
  que §2 protege; pero el salto no está probado con usuarios y es lo que hay que
  mirar en la próxima ronda. En un documento **enteramente escaneado** —el caso
  frecuente— no hay salto: cuenta 1, 2, 3… de 20.
- La UI pasa a escuchar `OCR_PAGE_FINISHED` para saber por cuál página va. Es
  una suscripción más en `bus-bridge.ts` y un campo más de store; no cambia el
  Core, pero es estado nuevo que hay que limpiar al cerrar el documento.

**Lo que no toca**: el Core —ninguna línea; los eventos y los totales ya son los
que hacen falta—, las tres fases de ADR-087 §1, ni el momento del pase, que lo
fija ADR-150.
