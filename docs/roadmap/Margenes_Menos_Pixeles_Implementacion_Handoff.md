<!-- CONTEXT: scope=handoff-implementacion | dependencias=adr/ADR-165-Una-Franja-Ya-Explicada-No-Se-Reconoce.md,core/OCR_Engine.md,roadmap/Margenes_Menos_Pixeles_Plan.md,roadmap/Margenes_Menos_Pixeles_Resultados.md,adr/ADR-162-Solo-Una-Franja-Visualmente-Blanca-Se-Saltea.md,adr/ADR-149-El-Test-Que-No-Ve-El-Rojo-No-Mide.md | audiencia=implementador+revisor | fase=11 -->

# I-1 — handoff de implementación y medición

Fecha: 2026-09-16. ADR-165 está aceptado y `OCR_Engine.md` v1.17.0 tiene el
spec (nota v1.17.0, §13 casos 26-29, §14 seis filas, §15 item 32). Este handoff
ordena la ejecución en dos etapas separadas.

## 0. Dos etapas, dos commits, en este orden

1. **Implementación** en `ocr-engine`, un commit, con sus tests.
2. **Medición A/B** del cambio ya implementado, en `tests/`, sin tocar producto.

La etapa 2 **decide si la etapa 1 se conserva**. No se declara éxito al
terminar la 1.

**Control BEFORE**: `3650ce7`. Ya incluye la errata v1.16.1, que tocó la misma
función. No comparar contra nada anterior.

## 1. Etapa 1 — implementación

El qué está en `OCR_Engine.md` §15 item 32 y en ADR-165 §2. Lo que agrega este
handoff son las trampas concretas:

### 1.1 La proyección, que es donde ya hubo un bug

Puntos → píxeles (`× dpi / 72`) → `unrotateBbox` con el ángulo
**complementario** (`(360 - orientation) % 360`) y las dimensiones del
**enderezado** → restar el `x0` de la franja.

**La regla que evita equivocarse**: `unrotateBbox` recibe siempre las
dimensiones del espacio **al que la caja va**, nunca del que viene. La errata
v1.16.1 fue exactamente este error en el sentido contrario. Verificalo con un
caso construido en las cuatro orientaciones antes de confiar en el resultado.

### 1.2 Reutilizar el predicado, no copiarlo

El predicado de píxel presente tiene que ser **el mismo código** que usa
`isVisuallyWhiteStrip`. Extraelo a una función y que los dos lo llamen. Una
copia divergente mide otra cosa y ningún test lo detecta.

### 1.3 Dónde va, exactamente

Después de la compuerta de ADR-162 —que se conserva intacta, como atajo que
corta al primer píxel no blanco— y antes de las dos rotaciones. Se evalúa
**una vez por franja**, no por rotación.

### 1.4 Ordenar el recorrido para cortar temprano

No hace falta contar todos los píxeles presentes: alcanza con **encontrar uno**
fuera de las cajas para decidir que la franja se lee. Cortá ahí. La regla se
paga en cada franja y ese costo se descuenta del ahorro en la etapa 2.

### 1.5 Fail-open en todos los caminos

Cualquier excepción o dato incoherente: **se ejecutan las pasadas**. Nunca
saltear por no haber podido comprobar. Mismo criterio que ADR-162.

### 1.6 Los píxeles que se leen son los originales

El enmascarado existe solo para decidir. A `recognize` nunca le llega una
imagen con regiones tapadas.

### 1.7 Tests

Las seis filas de §14, y entre ellas **el discriminante manda**: el de la
franja con tinta **no** explicada tiene que **fallar** contra una
implementación que saltee siempre. Escribilo y comprobá que falla contra un
stub que saltea incondicionalmente, antes de escribir la lógica real. Sin ver
ese rojo, el verde no significa nada (ADR-149 §2).

Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más
cobertura ≥85 % del módulo. Sin commit sin autorización (I-9).

## 2. Etapa 2 — medición A/B

**No empieza hasta que la etapa 1 esté aprobada por el planificador.**

### 2.1 Qué se compara

BEFORE = `3650ce7`. AFTER = el árbol con la etapa 1 aplicada. Son builds
separados, no un flag de producto.

### 2.2 Protocolo

El mismo de las campañas anteriores, que ya está probado: Electron real vía
`playwright.perf.config.ts`, un worker, retries 0, build fresco con `VITE_E2E=1`
por sesión, `userData` nuevo, frío → cerrar → caliente. Config fija:
`pdfPoolSize: 4`, `ocrPoolSize: 2`, `nerPoolSize: 2`, `renderPoolSize: 4`, NER
habilitado, `spa`+`eng`, DPI 300, `maxLiveImageBytes = 128 * 1024 * 1024`.

**Tres pares alternados**: `B1/A1, A2/B2, B3/A3`, con A = BEFORE y B = AFTER.
Encadenalos en un único script con `trap` de revert y un log por sesión.

Fixture: el P2 congelado
`.measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf`, SHA-256
`26f7f910…`. Congelar identidad como en las fases anteriores.

`pgrep -f '[p]laywright test --config'` con corchete antes de cada corrida.
Nada de `vitest` en paralelo.

### 2.3 Qué tiene que dar

| Condición | Verificación |
| --- | --- |
| El ahorro aparece | Delta de `ocrDurationMs` por encima del ruido, en los tres pares |
| No se pierde texto | Huella de calidad de P2 **idéntica** a `c723dace…`, 50 páginas, 1038 palabras |
| El sello se conserva | Corrida sobre el qa-stamp congelado: **21 palabras** (15 rotadas + 6 sobrantes) |
| El costo propio está neteado | El ahorro informado es el neto, no el bruto de las pasadas evitadas |

### 2.4 Cómo leerlo

El efecto esperado es de ~5,9 s sobre P2. El piso de ruido de esta máquina está
caracterizado: en el perfilado de ImageData los deltas iban de 446 a 1693 ms y
**se comían su propia mediana**. El efecto esperado es un orden de magnitud
mayor, así que **un resultado nulo no sería falta de potencia**: sería que la
proyección estaba equivocada.

Si el ahorro no aparece, o la calidad se mueve en cualquier dirección: se
informa así y **se revierte**. Una mejora proyectada que no se materializa es
un resultado publicable, no algo a rescatar ajustando el experimento. No
repitas corridas buscando una cifra mejor; conservá las inválidas rotuladas.

### 2.5 Entrega

`docs/roadmap/Margenes_Menos_Pixeles_Medicion_I1.md` con: identidad congelada,
los tres pares crudos, el delta con su dispersión, la huella de calidad, el
conteo de qa-stamp, el costo propio de la regla y las corridas inválidas. **Sin
decidir si se conserva**: eso lo hace el planificador con el humano.

## 3. Ambigüedad

Si un caso no está cubierto, dos documentos se contradicen, o un helper
referenciado no existe: **detener y reportar** archivo, sección, cita textual y
pregunta concreta. No elijas una tolerancia distinta de 1 px, no toques la
compuerta de ADR-162 y no agregues un campo de configuración.
