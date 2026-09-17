<!-- CONTEXT: scope=roadmap-plan | dependencias=adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md,adr/ADR-151-La-Primera-Pagina-Ya-Esta-Dibujada-Cuando-Se-Abre-El-Panel.md,adr/ADR-044-Seed-Del-Preview-Mediado.md,roadmap/Optimizacion_De_Memoria_Plan.md,tests/perf/README.md | audiencia=planificador+implementador+humano | fase=11 -->

# Arreglo del instrumento de memoria — plan

**Por qué existe este plan.** La re-caracterización del 2026-09-17 no pudo
responder si los cambios de OCR bajaron la memoria, y al investigar por qué
aparecieron tres defectos del instrumento. Ninguno se arregla solo, y mientras
sigan ahí **ninguna medición de memoria de esta campaña es interpretable**. No
toca código de producto: es todo `tests/`.

El trabajo previo que motivaba la re-caracterización queda cerrado sin
resultado por decisión del humano: los cambios medidos (ADR-161/162/163/164/165)
se conservan por su ahorro de tiempo, así que cuánto rindieron en memoria no
cambia ninguna decisión y no se mide.

## 1. La evidencia que lo dispara

Dos tandas del mismo commit (`1bbb219`), mismo build, mismo fixture, el mismo
día, con distinto estado de la máquina:

| P2 (50 p) | banco cargado | banco quieto | |
|---|---:|---:|---|
| Línea de base | 685,9 MB | 1077,8 MB | **+57 %** |
| Pico (M2) | 1390,9 MB | 2121,7 MB | **+53 %** |
| M1 (pico − base) | 376,4 MB | 377,5 MB | +0,3 % |

La escala entera se desplazó y la diferencia quedó clavada. El compresor de
macOS tenía 1,6 GB ocupados al terminar la segunda tanda: con la máquina recién
reiniciada hay RAM libre y los procesos retienen su working set completo; con
horas de uso el sistema aprieta y los mismos procesos reportan menos. M2 es una
suma de working sets, así que sigue esa presión en vez de seguir a la aplicación.

**Consecuencia**: M2 no es comparable entre corridas tomadas con distinta
presión de memoria del sistema, y eso incluye toda la serie histórica de la
campaña. El instrumento no registra esa variable, así que hoy no hay forma de
saber, mirando un reporte viejo, en qué condiciones se tomó.

## 2. A-1 — Registrar la presión de memoria del sistema

**Dónde**: `tests/perf/support/memoryProfile.ts` (o el sampler equivalente).
**ADR**: ninguno, es instrumento.

Cada reporte debe traer, al menos al abrir y al cerrar la corrida y idealmente
en cada muestra: páginas libres, páginas ocupadas por el compresor, y swap
usado. En macOS salen de `vm_stat`; el equivalente por plataforma se resuelve al
implementar.

**Cierra cuando** dos corridas del mismo perfil tomadas con presión distinta se
puedan distinguir leyendo el reporte, sin depender de que alguien se acuerde de
qué tenía abierto.

## 3. A-2 — «Pico fuera de fase» mezcla dos casos distintos

**Dónde**: `tests/perf/support/aggregateMemoryReports.ts` y el productor del
flag. **Decidido por el humano el 2026-09-17 y escrito en ADR-146 §7ter.**

ADR-146 §7bis marca inválida toda corrida cuyo máximo caiga fuera de las fases,
para atrapar un caso concreto: que el máximo sea **residuo del documento
anterior**, que aparece *antes* de `DOCUMENT_IMPORTED`.

**Medido sobre las dos tandas del 2026-09-17: de las 12 corridas descartadas,
las 12 tienen el pico *después* de la última fase. Ninguna antes.** Lo que hay
después de `PIPELINE_READY` no es residuo ajeno: es el precalentado de la página
1 (ADR-151) y el seed de previews (ADR-044), trabajo real del documento que se
acaba de importar.

Dos consecuencias, y la segunda importa más:

1. La regla descarta corridas válidas, y lo hace sistemáticamente con **P1**
   —cuyo pipeline dura 441-509 ms en caliente, así que su trabajo post-`Ready`
   pesa relativamente más—. P1 quedó 3/3 inválido en caliente en las dos tandas:
   **la campaña se quedó sin control** justo cuando más falta hacía.
2. Si el máximo real de la corrida ocurre después de `Ready` y se descarta,
   **el pico publicado es menor que el que el usuario experimenta**. Por eso
   §7ter lo conserva como métrica propia en vez de dejarlo afuera.

**Lo decidido** (ADR-146 §7ter): se clasifica por posición del máximo, y **M2
pasa a medirse dentro de la ventana de fases**.

| Posición del máximo | Hoy | Desde §7ter |
|---|---|---|
| Antes de `DOCUMENT_IMPORTED` | inválida | **inválida** — es el caso que §7bis quería atrapar |
| Dentro de las fases | válida | válida; M2 es ese máximo |
| Después de la última fase | inválida | **válida**; M2 es el máximo **dentro de las fases** |

El máximo posterior a `Ready` **no se descarta**: se reporta como métrica propia
junto a M2. Esa métrica es obligatoria — sin ella el cambio escondería el pico
que el usuario atraviesa, que es justo lo que §7bis quería evitar. La decisión
acepta a cambio que M2 deje de ser el pico absoluto de la aplicación: mide
procesar el documento, y dibujar la interfaz se mide aparte.

**Cierra cuando** el agregador aplique la clasificación de §7ter, M2 se calcule
sobre las muestras de la ventana de fases, el reporte traiga la métrica del pico
posterior, y exista un discriminante que falle contra la versión previa
(ADR-149 §2). Las 12 corridas del 2026-09-17 sirven de caso de prueba: deben
pasar a válidas.

## 4. A-3 — La cadencia no resuelve las fases cortas

**Dónde**: el sampler. **ADR**: ninguno.

El muestreo es de 150 ms. En P1 caliente el pipeline entero dura 441-509 ms y
sus fases individuales duran **9 a 17 ms**: de las 11 muestras del reporte, solo
**3 o 4** caen dentro de la ventana de fases, y las fases cortas no reciben
ninguna. El desglose por fase de P1 no puede ser correcto con esa resolución.

**Cierra cuando** cada fase de cada perfil reciba un mínimo de muestras, o el
reporte declare explícitamente que esa fase no es medible a la resolución usada.
Lo que **no** se acepta es publicar un desglose por fase construido sobre cero
muestras.

## 5. Lo que queda para el humano, y no es código

**Qué métrica compara entre bancos.** ADR-146 §7 fijó M2 como primaria y M1 como
«cota inferior que no decide por sí sola». Los datos del 2026-09-17 apuntan al
revés: M2 se movió 53 % entre dos bancos con el mismo build, y M1 de P2 dio
**375,4 / 376,4 / 377,5 MB** en tres tandas de tres condiciones distintas,
porque al ser una resta cancela el desplazamiento.

**No se generaliza**: P2-dense no lo replica —su M1 pasó de 562,8 (10-sep) a
590,4 y a 802,9— así que la estabilidad está observada en el perfil sparse, no
demostrada como propiedad de M1. Antes de tocar ADR-146 §7 hace falta decidir si
se investiga esa asimetría o si alcanza con registrar la presión (A-1) y
comparar solo entre corridas del mismo banco.

## 6. Orden

A-2 primero: es el que devuelve el control P1 y el que puede estar
subestimando el pico. A-1 después. A-3 al final, que es el de menor consecuencia.
Cada uno cierra con sus gates scoped y no toca `packages/`.

Con el instrumento arreglado, la pregunta de dónde recortar memoria se vuelve a
abrir sobre datos comparables. El dato más firme que hay hoy es que **P2-dense
da M1 de 783,4 / 797,3 / 814,1 MB contra el presupuesto de 512 MB**, tres de
tres y con 31 MB de dispersión — pero es un peor caso sintético, y si representa
o no un expediente real lo contesta el perfil P4, que sigue sin existir.
