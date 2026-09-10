<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,00_Project_Vision.md,core/Orchestrator.md,core/Render_Engine.md,ui/React_Client.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-144-El-Input-Se-Registra-Ya-El-Trabajo-Se-Planifica.md,adr/ADR-150-La-Pantalla-De-Escaneo-Dura-Lo-Que-Dura-El-Escaneo.md,adr/ADR-052-Blob-Urls-Tardios-Tras-Cerrar-Documento.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md | audiencia=humanos+IA | fase=11 -->

# ADR-151 — La primera página ya está dibujada cuando se abre el panel

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El humano, sobre la medición del "first preview" del plan de campaña de hardening (§9, H-07): pidió precalentar la primera página para evitar el panel en blanco, y que la métrica diga *realmente* cuánto tarda la aplicación y qué se busca.
- **Relacionado con**: ADR-150 (cuándo se abre el panel), ADR-144 §7 (prioridad de preview no visible), ADR-052 §3 (blob URLs tardíos), ADR-149 (el gate que verifica esto)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. El renglón que se estaba midiendo no medía lo que dice

`07_Performance_Strategy.md` §1 tiene, desde la fase 1:

> First preview (página 1, lado original) | < 1.5 s desde import

Se escribió cuando la UI eran cuatro paneles simultáneos y el visor estaba en
pantalla desde el arranque. Después ADR-087 §1 retiró ese layout: hoy el visor
**no existe** hasta que la pantalla de escaneo suelta al usuario. Nadie puede
pedir la página 1 antes, y nada la dibuja.

Medido, build de producción, `text-10p.pdf`, NER en frío:

| marca | valor |
|---|---|
| `DOCUMENT_PARSED` (las 10 páginas leídas) | ~100 ms |
| pase a ②b, montaje del visor y `RENDER_REQUESTED` | ~2770 ms |
| `PREVIEW_UPDATED` de la página 1 | ~2890 ms |

Dibujar la página cuesta **~120 ms**. El resto es esperar a entrar. Con el
detector de nombres apagado, el mismo PDF muestra la página 1 a los **281 ms**,
sin que cambie una línea del camino de render: la diferencia es cuándo suelta la
pantalla de escaneo, no cuánto tarda el dibujo.

O sea: ese renglón medía la pantalla de escaneo con un número pensado para otra
UI. Y desde ADR-150 mide, literalmente, el escaneo completo.

### 2. Y queda un blanco evitable al entrar

Aun con el momento de pase corregido, el visor monta, pide, y recién ~120 ms
después aparecen píxeles. En un documento grande la primera página tarda más.
El usuario espera todo el escaneo y, al final, entra a un panel vacío que se
llena. La página 1 está lista desde los 100 ms: lo único que falta es que
alguien la haya pedido.

## Decisión

### 1. La página 1 se precalienta **al terminar el escaneo**, no al empezarlo

El **Orchestrator** invoca `renderPage` para `(pageIndex: 0, kind: "original",
mode: "preview")` cuando el pipeline llega a `Ready` — en el mismo turno en que
lo alcanza, antes de que el usuario entre a ②b.

- **Solo en `Ready`/`Done`.** Un documento cancelado o fallido no precalienta
  nada: no hay panel que llenar, y ese es justamente el caso en el que el render
  se desperdiciaría.
- **Best-effort**, exactamente como el seed mediado de ADR-044: un fallo se
  loguea y no interrumpe nada ni escala a `PIPELINE_FAILED`. El preview nunca es
  motivo para fallar un pipeline.
- **Prioridad 20**, la de "preview de página no visible" que ADR-144 §7 ya
  distingue: precalentar no puede competir con un export.
- **Al `previewScale` por defecto**, que es la escala con la que el visor pide
  al montar con zoom 1 (medido: `scale=1`). Un zoom inicial distinto es un miss
  de caché, no un error: se dibuja como hoy.
- **Una sola página.**

**Y el pase a ②b espera ese preview** (ADR-150 §1). Sin esa espera el
precalentado en `Ready` no sirve para nada: el pase se dispara con el mismo
`stage === Ready` que lo lanza, así que la pantalla soltaría al usuario con el
render todavía en vuelo y el blanco volvería igual. La espera está acotada por
una gracia, para que un render que falla no deje a nadie encerrado en la
pantalla de escaneo.

En el caso rápido no cuesta nada: un PDF nativo chico llega a `Ready` en menos de
un segundo y el render entra **adentro del piso de 1,2 s** de ADR-150, que el
usuario iba a esperar de todos modos. En el caso lento —un escaneado largo— suma
un render de una página al final de una espera que ya fue de segundos.

### 2. No hace falta tocar el visor

`bus-bridge.ts` ya escribe todo `PREVIEW_UPDATED` en
`viewer.store.previewByPage[kind]`, **haya o no un visor montado**. El preview
precalentado queda ahí; cuando ②b monta, `PageCanvas` pinta con lo que ya está
en el store. No hay pedido nuevo, no hay ida y vuelta al worker, no hay blanco.

El ciclo de vida de los blob URLs no cambia: es el mismo `PREVIEW_UPDATED` de
siempre, con la revocación de ADR-052 §3 al reemplazarlo o al cerrar el
documento. Un precalentado sobre un documento que se cierra antes de abrir ②b
se revoca por ese mismo camino.

### 3. La métrica dice lo que pasa

Se **retira** de `07_Performance_Strategy.md` §1 el renglón
"First preview (página 1, lado original) | < 1.5 s desde import", y se
reemplaza por dos que se pueden medir y que describen el producto que existe:

| Métrica | Objetivo | Qué mide |
|---|---|---|
| Primera página visible al abrir el panel de trabajo | **ya dibujada**: cero `RENDER_REQUESTED` necesarios y píxeles en el primer frame de ②b | Que el precalentado de §1 hizo su trabajo |
| Import → panel de trabajo | el presupuesto de extremo a extremo de su clase de documento (`00_Project_Vision.md` §7: < 8 s nativo, < 60 s escaneado), más el piso de 1,2 s de ADR-150 | Lo que el usuario realmente espera |

La segunda fila **no agrega un número nuevo**: desde ADR-150, "import → panel de
trabajo" y "import → `Ready`" son el mismo instante, y ese ya tiene presupuesto
contractual. Un número menos que mantener, y ninguno inventado.

Valores medidos hoy para la primera fila de referencia (producción,
`text-10p.pdf`, NER en frío, tres corridas): `PIPELINE_READY` a **3960 / 3490 /
3536 ms**, contra el presupuesto de 8 s.

**Nota documental**: el renglón retirado nunca estuvo en la tabla contractual de
`00_Project_Vision.md` §7 — se agregó solo en Performance §1. Retirarlo no toca
el contrato de producto. El otro renglón de §1 sin contraparte en Vision §7,
"Re-render delta tras editar 1 grupo | < 150 ms", **queda como está**: mide algo
que sí ocurre dentro de ②b y no lo alcanza esta decisión.

### 4. Qué verifica el gate

El gate de Performance (H-07, ADR-149) verifica los dos presupuestos de Vision
§7 (8 s / 60 s) y la primera fila de §3 — que al abrir ②b la página 1 ya esté en
el store, sin `RENDER_REQUESTED` de por medio. **No** asserta el renglón
retirado: un gate no puede verificar una métrica que ya no existe.

## Consecuencias

**A favor**

- Desaparece el blanco al entrar: la transición de ②a a ②b muestra la página en
  el primer frame.
- El costo es un render de una página, en la ventana en la que el pipeline está
  esperando a NER de todos modos, con prioridad de fondo.
- La tabla de §1 deja de tener un objetivo imposible por diseño. Los números que
  quedan describen la aplicación que existe, y uno de ellos ya era contractual.

**En contra**

- **El pase a ②b queda atado a un render.** Si ese render se cuelga, lo único
  que separa al usuario de su panel es la gracia. Por eso la gracia es
  obligatoria y su vencimiento es un camino normal, no un error: se entra igual,
  con el blanco de antes. Un pase que dependa de que un render salga bien sería
  peor que el problema que arregla.
- **Se suma un render al final de la espera.** Medido en un PDF nativo son
  ~120 ms sobre una espera de 3,5-4 s; en un escaneado grande la página es más
  pesada y no está medida. H-10 la mide con su fixture de 50 páginas.
- Si algún día ②b vuelve a montarse antes de `Ready` (o sea, si se revierte
  ADR-150), el precalentado sigue siendo correcto pero deja de ser suficiente:
  habría que precalentar el rango visible, no una página.

**Lo que no toca**: `Contracts.md` —no hay evento, tipo ni error code nuevo—, el
visor, el store, el camino de export, ni la mediación de ADR-044.

## Alternativas consideradas

| Decisión | Alternativa | Por qué no |
|---|---|---|
| Precalentar en `Ready` | Precalentar apenas `ensureRenderDocumentLoaded` resuelve, mucho antes (era la primera redacción de este ADR) | Gasta un render y un blob que se tiran si el usuario cancela a mitad del escaneo, y compite —poco, pero compite— con la rasterización de OCR, que usa la misma pool. En `Ready` no hay nada con qué competir y el trabajo no puede desperdiciarse: el panel se abre sí o sí. El costo de mover el precalentado al final es que el pase tiene que esperarlo, y ese costo está acotado por la gracia y absorbido por el piso en los documentos rápidos. |
| Precalentar la página 1 | Precalentar el rango visible inicial | Cuántas páginas entran en el viewport depende del tamaño de ventana y del zoom, que el Core no conoce y no debe conocer (ADR-144 §8: no se importan stores de React al motor). La página 1 es la única que se sabe visible sin preguntarle nada a la UI. |
| Que el pase espere el preview | Que el pase salga en `Ready` y el preview llegue cuando llegue | Es exactamente el blanco que este ADR existe para sacar. Sin la espera, precalentar en `Ready` no cambia nada respecto de no precalentar. |
