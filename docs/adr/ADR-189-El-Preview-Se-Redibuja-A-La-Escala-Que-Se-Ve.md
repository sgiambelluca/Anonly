<!-- CONTEXT: scope=adr | dependencias=core/Render_Engine.md,core/Orchestrator.md,core/Contracts.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-044-Preview-Grupos-Mediacion-Orchestrator.md,adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-144-El-Input-Se-Registra-Ya-El-Trabajo-Se-Planifica.md,adr/ADR-151-La-Primera-Pagina-Ya-Esta-Dibujada-Cuando-Se-Abre-El-Panel.md,roadmap/Revision_Por_Bloques_Hardening.md | audiencia=humanos+IA | fase=11 -->

# ADR-189 — El preview se redibuja a la escala que se ve

- **Estado**: Aceptado.
- **Fecha**: 2026-09-26.
- **Decidido por**: el humano, a propuesta del planificador.
- **Origen**: revisión de la ronda A, O-1, y la observación fuera de alcance
  sobre ADR-044 (`Revision_Por_Bloques_Hardening.md`).
- **Alcance**: `render-engine` y el Orchestrator del façade. **Sin cambio de
  contrato**: `PREVIEW_UPDATED`, `RENDER_REQUESTED` y `RenderPageInput` quedan
  como están.
- **Relacionado con**: ADR-037 (zoom con re-render, `RENDER_REQUESTED.scale`
  y supersede), ADR-044 (preview mediado por el Orchestrator), ADR-056 (un
  `kind` por panel), ADR-144 (planificador de previews), ADR-151
  (precalentado de la página 1).

## Contexto

El visor muestra cada página a la escala que corresponde al zoom. Cuando el
usuario hace zoom, el panel emite `RENDER_REQUESTED` con esa escala
(ADR-037 §1), y el motor la respeta.

Hay dos caminos en los que el Core dibuja una página **por su cuenta**, sin
que el visor la pida:

1. **El preview mediado de ADR-044.** Después de cada cambio de grupos
   (agregado manual, eliminar, restaurar, reanálisis), el Orchestrator
   redibuja con `renderPage` directo las páginas anonimizadas afectadas.
2. **El precalentado de ADR-151.** Al llegar a `Ready`, el Orchestrator
   dibuja la página 1 del lado original.

Los dos invocan `renderPage` **sin `scale`**, así que caen a `previewScale`,
la escala de zoom 100%. Con el visor en otro zoom, el `PREVIEW_UPDATED` que
resulta reemplaza en la UI la imagen nítida por una de menor resolución
estirada. La página se ve borrosa hasta que el usuario vuelve a tocar el zoom.

Además, el precalentado no corre una sola vez: vuelve a correr en cada
`GROUPING_FINISHED` que llega a `Ready`, es decir, después de cada edición.
Su propósito (ADR-151 §1) es que la página 1 esté lista **antes de entrar
a la pantalla de trabajo**, y eso ocurre una sola vez por documento.

El humano fijó el requisito: **la página nunca se ve borrosa por una edición,
ni siquiera por un instante**.

### Por qué no se resuelve en la UI

La alternativa obvia es que `PREVIEW_UPDATED` lleve su escala y que la UI
ignore las imágenes a una escala que no es la que muestra. Tiene un defecto de
fondo: el Orchestrator revoca la URL anterior de cada
`(documentId, pageIndex, kind)` cada vez que llega un `PREVIEW_UPDATED`
nuevo (ADR-034 §5). Si la UI se quedara con la imagen nítida, esa URL ya
estaría revocada. Arreglarlo exige indexar las URLs por escala y retenerlas,
con un costo de memoria por cada nivel de zoom usado. Es más simple que el Core
**no produzca** imágenes a una escala vieja.

## Decisión

### 1. `RenderEngine` recuerda la escala vigente de cada lado

Por cada `(documentId, kind)`, el motor guarda la **escala vigente del
preview**: la del último `RENDER_REQUESTED` con `mode: "preview"` para ese
`kind`, o `previewScale` si el pedido no trae escala. Hasta el primer pedido
no hay escala vigente.

- Se actualiza al recibir el evento, antes de validar las páginas, y **solo**
  si la escala es válida. Una escala fuera de rango sigue siendo `warn` y
  no-op (ADR-037 §2) y no toca la vigente.
- Se borra con el resto del estado del documento: `unloadDocument`,
  `loadDocument` de recarga y `dispose`.
- Los pedidos con `mode: "full"` (export) no la tocan.

### 2. El preview sin escala explícita sigue la escala vigente

Una invocación directa de `renderPage`/`renderPages` con `mode: "preview"` y
**sin** `scale` se dibuja a la escala vigente de su `kind`, o a
`previewScale` si no hay vigente.

Si al terminar el kernel la escala vigente de ese `kind` cambió, el resultado
**no se emite**: se descarta y se vuelve a despachar a la vigente, leyendo el
input vigente de la página (el mismo criterio de ADR-144 para una generación
vieja). La promesa de la invocación resuelve con el render final.

**Nunca se emite un `PREVIEW_UPDATED` a una escala que ya no es la vigente**
para ese lado. Para los renders que nacen de `RENDER_REQUESTED`, ADR-037 §4 ya
lo garantizaba; este ADR extiende la garantía a los renders mediados.

No cambia:

- Una invocación directa **con** `scale` explícita se dibuja a esa escala,
  como hoy: el export y los tests.
- Las invocaciones directas siguen sin participar del supersede de
  `RENDER_REQUESTED` (`Render_Engine.md` §13 caso 21).
- La clave de caché y la del planificador de ADR-144 siguen incluyendo la
  escala efectiva. Un acierto de caché a la escala vigente se emite como hoy.

### 3. El precalentado corre una vez por documento

`prewarmFirstPagePreview` se invoca solo la **primera** vez que un documento
llega a `Ready`. El Orchestrator lo marca en el estado del documento, y la
marca muere con `closeDocument`. Un `Ready` posterior (agregado manual,
reanálisis, eliminar o restaurar) no vuelve a precalentar. El preview mediado
de ADR-044 sigue actualizando las páginas afectadas, ahora a la escala
vigente (§2).

### 4. Lo que el usuario ve

- **Al editar con cualquier zoom:** la página afectada se redibuja
  directamente a la escala que se ve. Mientras tanto se sigue mostrando la
  imagen anterior, nítida, y después la nueva, también nítida.
- **Al hacer zoom:** no cambia. Durante la transición de zoom la imagen
  previa se estira hasta que llega la nueva (ADR-037). Eso lo provoca el zoom
  mismo, no una edición.

## Pruebas exigidas

`render-engine`:

- `mediated preview follows the current scale of its kind`: con un
  `RENDER_REQUESTED { kind: "anonymized", scale: 1.5 }` previo, un
  `renderPage` directo sin escala emite `PREVIEW_UPDATED` renderizado a 1,5.
- `current scale is tracked per kind`: la escala del lado original no afecta
  al anonimizado, y viceversa.
- `mediated preview never emits an obsolete scale`: la escala vigente cambia
  mientras el kernel trabaja. No se emite el resultado viejo y sí se emite
  uno a la escala nueva, con el input vigente.
- `explicit scale bypasses the current scale`: `mode: "full"` y el preview con
  `scale` explícita se dibujan a su escala.
- `invalid RENDER_REQUESTED scale leaves the current scale untouched`.
- `current scale is cleared on unload and reload`.

Orchestrator:

- `first page is prewarmed only on the first Ready of a document`: un segundo
  `GROUPING_FINISHED` que llega a `Ready` (agregado manual o reanálisis) no
  vuelve a llamar a `renderPage` para el precalentado.

Los nombres entran en §14 de cada spec.

## Consecuencias

- Una edición nunca baja la resolución de una página visible.
- Un render mediado puede despacharse dos veces si el usuario cambia el zoom
  mientras se dibuja. Es un costo acotado, porque solo ocurre con un cambio
  de zoom en vuelo, y es el mismo patrón que ADR-144 ya aceptó para las
  generaciones viejas.
- Las páginas no visibles que el preview mediado actualiza se dibujan a la
  escala que se está usando, que es con la que se van a ver al hacer scroll.
- El precalentado deja de repetir trabajo en cada edición.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Agregar `scale` a `PREVIEW_UPDATED` y que la UI ignore las imágenes a otra escala | La URL que la UI querría conservar ya la revocó el Orchestrator (ADR-034 §5). Evitarlo exige retener una URL por escala. Además es un cambio de contrato para un problema que el Core puede no generar. |
| Que el Orchestrator pase la escala en cada render mediado | El Orchestrator no escucha `RENDER_REQUESTED` (ADR-034 §7), así que no sabe el zoom. Suscribirlo duplica un estado que el motor ya tiene. |
| Precalentar solo una vez, sin tocar el preview mediado | Sacaría una sola de las dos causas. Después de una edición, la página anonimizada se seguiría viendo borrosa por ADR-044. |
