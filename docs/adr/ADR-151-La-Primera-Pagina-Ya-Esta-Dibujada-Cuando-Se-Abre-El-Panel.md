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

### 1. La página 1 se precalienta apenas Render tiene el documento

El **Orchestrator** invoca `renderPage` para `(pageIndex: 0, kind: "original",
mode: "preview")` inmediatamente después de que `ensureRenderDocumentLoaded`
resuelve — el mismo punto del pipeline que ya existe, mucho antes de `Ready`.

- **Best-effort**, exactamente como el seed mediado de ADR-044: un fallo se
  loguea y no interrumpe nada ni escala a `PIPELINE_FAILED`. El preview nunca es
  motivo para fallar un pipeline.
- **Prioridad 20**, la de "preview de página no visible" que ADR-144 §7 ya
  distingue: precalentar no puede competir con lo que el usuario está mirando ni
  con un export.
- **Al `previewScale` por defecto**, que es la escala con la que el visor pide
  al montar con zoom 1 (medido: `scale=1`). Un zoom inicial distinto es un miss
  de caché, no un error: se dibuja como hoy.
- **Una sola página.** Precalentar más es trabajo que compite con el escaneo,
  que es lo que el usuario está esperando de verdad.

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

- **Un render que puede no usarse.** Si el usuario cancela durante el escaneo,
  se pagó una página de render y un blob URL que se revoca. Es el precio más
  barato de la lista y es acotado a una página.
- El precalentado **compite** —poco, pero compite— con la rasterización de OCR
  en un documento escaneado, que usa la misma pool. La prioridad 20 lo pone
  atrás de todo; si H-10 mide que igual molesta, la salida es condicionarlo a
  documentos sin páginas para OCR, no subirle la prioridad.
- Si algún día ②b vuelve a montarse antes de `Ready` (o sea, si se revierte
  ADR-150), el precalentado sigue siendo correcto pero deja de ser suficiente:
  habría que precalentar el rango visible, no una página.

**Lo que no toca**: `Contracts.md` —no hay evento, tipo ni error code nuevo—, el
visor, el store, el camino de export, ni la mediación de ADR-044.
