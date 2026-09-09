<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,00_Project_Vision.md,roadmap/MVP.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md | audiencia=humanos+IA | fase=11 -->

# ADR-146 — Son dos presupuestos de memoria, no dos límites del mismo

- **Estado**: Accepted
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

### 7. Qué se corrige en los documentos

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
