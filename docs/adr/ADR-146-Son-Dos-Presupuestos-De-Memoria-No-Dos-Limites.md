<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,00_Project_Vision.md,roadmap/MVP.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md | audiencia=humanos+IA | fase=11 -->

# ADR-146 — Son dos presupuestos de memoria, no dos límites del mismo

- **Estado**: Accepted (**§1 precisado y §6 ampliado el 2026-09-10**, tras medir con el instrumento ya corregido: M1 es una **cota inferior**, no una medida de demanda, y la atribución compara **picos entre sí**, no diferencias contra una línea de base. Ver la enmienda al final de la Decisión. **§7ter, 2026-09-17, decidido por el humano**: «fuera de fase» mezclaba dos casos y descartó 12 corridas válidas; M2 pasa a medirse dentro de la ventana de fases y el pico posterior a `Ready` se reporta como métrica propia)
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, resolviendo D-06 del plan de campaña de hardening (§2, §2.1, §15).
- **Relacionado con**: `00_Project_Vision.md` §7 (la métrica contractual), `07_Performance_Strategy.md` §1/§7/§11.4, ADR-130/132 (el contenedor, que es dónde se mide ahora), ADR-080 (workers liberables por idle)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Dos frases que no pueden ser el mismo número

`07_Performance_Strategy.md` §1 y `00_Project_Vision.md` §7 dicen:

> Pico de memoria para 50 páginas | **< 512 MB**

y §7.1 del mismo documento cierra su tabla de presupuestos con:

> **Total pico (con OCR + NER)** | **~ 1.6 GB** | Bajo objetivo.

1,6 GB no está "bajo" 512 MB. Mientras la contradicción siga escrita, cualquier
gate de memoria es arbitrario: se cumple o se incumple según cuál de las dos
frases se cite.

### 2. Pero no miden lo mismo, y por eso las dos pueden ser ciertas

La tabla de §7.1 suma cosas de dos naturalezas distintas:

- Lo que cuesta **el runtime**, sin importar el documento: bundle + shell
  (80 MB), wasm de pdf.js (80 MB), Tesseract + modelo (300 MB), ONNX + modelo
  Q8 (400 MB), workers de render (480 MB). Un PDF de 1 página y uno de 50 pagan
  lo mismo.
- Lo que cuesta **el documento**: `Document` en memoria (20 MB), LRU de palabras
  (20 MB), LRU de `ImageData` (200 MB), grupos y anotaciones (10 MB). Esto sí
  crece con las páginas.

Un presupuesto que dice "**para 50 páginas**" y mete adentro 700 MB de modelos
que no dependen de las páginas es un error de categoría. Con esa lectura, las
dos frases dejan de contradecirse: describen métricas distintas.

### 3. Y hoy no hay con qué zanjarlo

No hay medición de pico representativa. El proceso Node que dirige Playwright no
representa el consumo de Electron, y el heap de la página no incluye WASM,
recursos nativos ni los demás procesos del árbol. Cualquier número que se fije
antes de tener el instrumento es una opinión.

## Decisión

### 1. Dos métricas, con nombre

**M1 — memoria atribuible al documento.** Pico observado durante el
procesamiento **menos** la línea de base medida con los modelos ya cargados y
**sin** documento abierto, en la misma corrida. Es la métrica que escala con las
páginas y la que gobierna la fila contractual "pico de memoria para 50 páginas".

- Presupuesto: **< 512 MB** (`00_Project_Vision.md` §7, MVP; 320 MB en v1.0).

**M2 — pico total del árbol de procesos.** Suma del RSS de todos los procesos
de la aplicación durante la corrida. Es la métrica que gobierna "¿entra en el
equipo del usuario?".

- Presupuesto: **~1,6 GB** con OCR y NER cargados; **~870 MB** sin ellos, que es
  lo que ya dice §7.1 y que ahora queda etiquetado como M2.

Ningún reporte de memoria puede omitir de cuál de las dos habla. "Bajó la
memoria" sin la etiqueta no es un resultado.

### 2. Unidades, explícitas

**MB = 1.000.000 bytes** y **MiB = 1.048.576 bytes**, en todos los documentos y
tablas. Los presupuestos existentes (512 MB, 1,6 GB, 200 MB) se leen en unidades
decimales. Toda medición guarda además el valor **en bytes**, para que ninguna
comparación dependa de cómo se redondeó.

### 3. Suma RSS, y se llama así

El instrumento es `app.getAppMetrics()` del proceso main de Electron, leído
desde el arnés de test con `electronApp.evaluate()` —el mismo mecanismo que ya
usan los E2E—. **No** se agrega IPC de acceso al sistema a la aplicación de
producción.

Lo que produce es una **suma de RSS**: las páginas compartidas entre procesos se
cuentan más de una vez, así que M2 es una cota superior, no memoria física
única. Se reporta con ese nombre. Si en algún momento se usa memoria privada o
PSS, se declara la disponibilidad por sistema operativo y **no se comparan
corridas medidas con métricas distintas**.

### 4. Perfiles

Un perfil es la tupla (documento, modelos, temperatura, hardware). Los tres
obligatorios:

| Perfil | Documento | Modelos | Temperatura |
|---|---|---|---|
| P1 — control nativo | 10 páginas con texto | NER | fría y caliente |
| P2 — escaneo largo | 50 páginas escaneadas (fixture de H-10) | OCR + NER | fría y caliente |
| P3 — ciclo | fixture manejable, 10 open/close | los que queden por idle | caliente |

**Fría** = ningún modelo cargado desde que arrancó el proceso. **Caliente** = los
modelos ya cargados por un documento anterior en el mismo arranque. Una línea de
base tomada sin modelos **no** se compara contra un cierre que legítimamente los
conserva durante el idle (ADR-080).

Cada corrida registra sistema operativo, RAM, CPU, versiones de Electron y de
los modelos, commit limpio, settings efectivos y tamaños de pool efectivos —los
de la UI, no los defaults del Core—.

### 5. Muestreo

Intervalo declarado por corrida; punto de partida **100–250 ms**, calibrando el
costo del propio muestreo. Es un parámetro del experimento, **no** un requisito
normativo: convertirlo en contrato antes de medir sería fijar por decreto algo
que la medición tiene que informar.

### 6. Cómo se convierte en gate

Tres corridas frías y tres calientes por perfil para conocer la variabilidad.
El gate compara el **máximo** de las corridas contra el presupuesto de su
métrica y perfil. **Un OOM no se promedia**: es un fallo medido, y una corrida
abortada por el límite de seguridad del runner es "no cumple", nunca "éxito
parcial".

Un resultado no disponible se reporta como **inconcluso**, no como cero.

### 7. Enmienda (2026-09-10): M1 es una cota inferior, y la atribución compara picos

Medido con el fixture ya fuera del renderer y con la línea de base caliente
tomada como el mínimo de una ventana de 4 s tras el cierre —las dos correcciones
que este ADR pedía—, tres corridas del mismo perfil P2 dieron:

| corrida | línea de base | pico | M1 (pico − base) |
|---|---|---|---|
| 1 | 1031,9 MB | 1788,4 MB | 756,5 MB |
| 2 | 1076,4 MB | 1943,9 MB | 867,5 MB |
| 3 | **1632,3 MB** | **2133,1 MB** | **500,8 MB** |

La corrida 3 no tiene una línea de base "sucia" por retraso del recolector: tiene
la línea de base **y** el pico más altos de las tres. Las dos se movieron juntas,
y la resta salió **más chica**.

Eso no es ruido de muestreo: es cómo funciona el RSS. Cuando el proceso ya tiene
memoria residente libre por dentro, el trabajo del documento se acomoda ahí sin
pedirle nada nuevo al sistema, y el crecimiento observado **subestima la demanda
real**. Ninguna ventana más larga lo arregla, porque no es un problema de cuándo
se mira.

**Consecuencias normativas:**

1. **M1 es una cota inferior de lo que cuesta el documento**, no una medida de su
   demanda. Un M1 por debajo del presupuesto **no** demuestra que el perfil
   cumpla; un M1 por encima sí demuestra que no cumple. Se reporta como tal.
2. **M2 es la métrica primaria.** Es una lectura directa del pico, sin resta, y
   por lo tanto no hereda este problema.
3. **La atribución se hace _dentro_ de una corrida, por fase — no comparando
   corridas.** Esta regla decía "comparar M2 entre configuraciones, alternando
   condición por condición". Se probó y **no tiene resolución**: aislando
   `renderPoolSize` (4 contra 1, alternado, 3 pares) los deltas fueron −83 MB en
   caliente y +264 MB en frío —direcciones opuestas, cada una consistente 3/3
   consigo misma— con un ruido de M2 ya medido de ~345 MB. Con n=3, tres de tres
   en una dirección ocurre una de cada cuatro veces por azar.

   Ningún lever candidato (50-400 MB) es más grande que el ruido entre corridas,
   así que **restar dos corridas no puede resolverlos**, ni con el doble de
   repeticiones: bajar el error estándar por debajo de 50 MB pediría del orden de
   cincuenta corridas por condición.

   En su lugar se usa la **serie temporal por fase de una sola corrida**, que el
   sampler ya produce y cuyos límites ya están instrumentados (`OCR_STARTED`,
   `OCR_FINISHED`, `NER_MODEL_READY`, `PIPELINE_READY`…): cuánto sube el RSS
   durante cada fase, cuánto baja al terminarla y cuál es el máximo dentro de
   cada una. Es una medición **intra-corrida**, inmune a la deriva entre
   corridas, y atribuye por etapa —que es lo que se quiere saber— en vez de por
   configuración. Para que sirva hay que **persistir la serie**, no solo el
   máximo.
4. **Solo se comparan corridas de la misma sesión y con el equipo por lo demás
   inactivo.** Medido: la dispersión de M2 pasó de 3,4 % a 17,6 % entre dos
   tandas del mismo perfil, con medias casi idénticas (1968 contra 1955 MB) — o
   sea, variación del entorno, no del producto. Con 17,6 % sobre ~2 GB, el ruido
   es de ~345 MB: más grande que varios de los deltas que la atribución busca.

### 7bis. Enmienda (2026-09-12): la corrida caliente espera a que la instancia se asiente

El perfil caliente de §4 —importar, cerrar, importar de nuevo en la misma
instancia— arranca la segunda importación sin esperar a que la memoria del primer
documento termine de decaer. Medido sobre 3 corridas de P2: las líneas de base
calientes fueron 849, 2094 y 2333 MB, y en **2 de las 3** el máximo de todo el run
caliente cayó **antes de `DOCUMENT_IMPORTED`** — o sea que el "pico" del run no
tuvo nada que ver con procesar el documento.

Eso contamina las dos métricas: a M1 ya se le conocía (§7), y a **M2** le arruina
la ubicación del máximo, que es justo lo que la atribución por fase necesita.

La corrida caliente pasa a **esperar a que el RSS se estabilice** antes de
importar el segundo documento —el mismo criterio con el que §7 toma la línea de
base: muestrear hasta que la serie deje de bajar, sin forzar GC—, y la línea de
base caliente se toma de esa ventana estabilizada. Una corrida cuyo máximo caiga
igual fuera de toda fase se reporta como **inválida**, no se promedia con las
otras.

### 7ter. Enmienda (2026-09-17): «fuera de fase» eran dos casos, y solo uno es inválido

§7bis marca inválida toda corrida cuyo máximo caiga fuera de las fases. Nació de
un caso concreto y bien identificado: el máximo que es **residuo del documento
anterior**, que aparece *antes* de `DOCUMENT_IMPORTED`. El criterio que se
escribió es más ancho que el caso que lo motivó, y esa diferencia resultó cara.

**Medido sobre dos tandas completas del 2026-09-17** (mismo commit `1bbb219`,
mismo build, distinto estado de máquina): de las **12 corridas descartadas, las
12 tienen el máximo *después* de la última fase. Ninguna antes.** Lo que ocurre
ahí no es residuo ajeno: es el precalentado de la página 1 (ADR-151) y el seed
de previews (ADR-044), trabajo real del documento recién importado, que corre
justo después de `PIPELINE_READY`.

El costo fue concreto: **P1 quedó 3/3 inválido en caliente en las dos tandas**.
Su pipeline dura 441-509 ms, así que su trabajo posterior a `Ready` pesa
relativamente más que en P2 — y P1 es el control de ruido. La campaña se quedó
sin control justo en la tanda que debía interpretar un resultado dudoso.

#### La clasificación pasa a ser por posición del máximo

| Posición del máximo del run | Corrida | M2 |
|---|---|---|
| Antes de `DOCUMENT_IMPORTED` | **inválida** — es el caso de §7bis | — |
| Dentro de las fases | válida | el máximo |
| Después de la última fase | **válida** | el máximo **dentro de las fases** |

Y **M2 pasa a definirse sobre las muestras de la ventana de fases**, no sobre
todo el run. El máximo posterior a `Ready` se reporta **como métrica propia**,
junto a M2, nunca fundido con él ni descartado.

#### Lo que esta decisión cuesta, dicho de frente

M2 deja de ser el pico absoluto de la aplicación durante la corrida. Un usuario
que importa un documento y ve abrirse el panel atraviesa ese pico posterior, y a
partir de esta enmienda M2 no lo cuenta. **Se acepta a sabiendas**: la decisión
del humano es que M2 mida *procesar el documento* y que *dibujar la interfaz*
sea una métrica separada, en vez de una sola cifra que mezcla las dos y no
permite atribuir ninguna. Por eso la métrica nueva es obligatoria y no opcional:
sin ella este cambio sí escondería el pico, que es exactamente lo que §7bis
quería evitar.

Un presupuesto que se compare contra M2 se compara, desde acá, contra el pico
del pipeline. Si alguna vez se quiere un umbral sobre el pico que ve el usuario,
es sobre la métrica nueva y necesita su propia decisión.

### 8. Qué se corrige en los documentos

`07_Performance_Strategy.md` §1 y §7 dejan de presentar dos números sin
etiqueta: cada fila declara si es M1 o M2, y §7.1 separa las líneas de runtime
de las de documento con su subtotal. `00_Project_Vision.md` §7 conserva su fila
contractual, ahora definida como M1. La tabla de gates de §11.4 sigue siendo la
única fuente de verdad de comandos y estados.

## Consecuencias

**A favor**

- Las dos frases dejan de contradecirse sin que ninguna se borre: cada una pasa
  a medir lo que puede medir.
- La métrica contractual queda atada a lo que escala con el documento, que es lo
  que la frase "para 50 páginas" siempre quiso decir.
- El instrumento existe hoy, es el del contenedor real y no obliga a agregarle
  nada a la aplicación de producción.

**En contra**

- **M1 depende de una resta**, y por lo tanto de que la línea de base sea
  estable. Si el runtime varía entre corridas, M1 hereda ese ruido. Por eso se
  exigen varias corridas y se guarda la serie temporal, no solo el máximo.
- Suma RSS **sobrestima**. Es la métrica disponible y comparable entre sistemas;
  llamarla "memoria usada" sin más sería inexacto.
- Es un ADR que **no fija los números finales del gate**: los define y dice de
  dónde salen. Quien busque acá un umbral para poner en CI hoy no lo va a
  encontrar, y esa ausencia es deliberada: primero H-10 mide.

**Lo que no toca**: el código de producción —ninguna línea—, la tabla de gates
de §11.4 (que se actualiza cuando el gate exista, no antes) ni los presupuestos
por caché de §6, que siguen siendo presupuestos de componente y no métricas de
proceso.
