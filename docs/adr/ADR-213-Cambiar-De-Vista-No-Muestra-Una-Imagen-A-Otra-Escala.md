<!-- CONTEXT: scope=adr-aceptado | dependencias=adr/ADR-056-RenderRequested-Kind-Por-Panel.md,adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-189-El-Preview-Se-Redibuja-A-La-Escala-Que-Se-Ve.md,adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md,adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md,ui/React_Client.md,ui/Components.md,roadmap/hardening/Confianza_1.0.x_Plan.md | audiencia=humanos+IA | fase=12 -->

# ADR-213 — Cambiar de vista no muestra una imagen a otra escala

- **Estado:** Aceptado por el mantenedor el 2026-10-07. El punto 1 revisa una
  decisión suya anterior (ADR-056), y lo aceptó sabiendo el costo: son pocas
  páginas por zoom.
- **Fecha:** 2026-10-07.
- **Alcance:** `apps/react-client`, el visor. No cambia el Core ni ningún
  contrato.

## Contexto

Después de un zoom, pasar de Original a Anonimizado (o al revés) mostraba la
imagen guardada del otro lado, dibujada a la escala anterior y estirada. Se
veía borrosa hasta el próximo zoom o scroll. Pasaba lo mismo después de
editar una entidad mirando Original.

El arreglo del 2026-10-07 hace que el visor pida la imagen del lado nuevo al
conmutar. La imagen nítida llega sola, pero entre el cambio de vista y su
llegada pasan unos 150 a 200 ms en los que se ve la imagen estirada. El
mantenedor pidió eliminar ese instante: es corto, y justamente por eso el
usuario ve que algo cambió sin saber qué.

Dos datos del diseño actual:

- **Se dibuja solo el lado que se mira** (ADR-056, decisión del mantenedor).
  Nació con dos paneles a la vista y scroll independiente: scrollear uno
  hacía redibujar el otro sin necesidad. Desde ADR-087 hay un solo visor con
  un conmutador.
- **El visor no sabe a qué escala está una imagen guardada.** El evento que la
  trae no lo dice, y ADR-189 descartó agregarlo. Pero el visor es el único
  que pide imágenes con escala, y el motor nunca entrega una imagen a una
  escala distinta de la última pedida para ese lado (ADR-189 §2). Con eso
  alcanza para saberlo sin cambiar el contrato.

## Decisión

1. **Al terminar un zoom, el visor actualiza los dos lados.** Pide primero el
   lado que se mira y después el otro, para las mismas páginas y a la misma
   escala. El otro lado se dibuja en segundo plano.

   Es el único cambio respecto de ADR-056, y está acotado al zoom: **el scroll
   sigue pidiendo solo el lado que se mira**, que era el caso que ADR-056
   quería barato.
2. **El visor recuerda a qué escala llegó cada imagen.** Por lado y por
   página, guarda la última escala que había pedido para ese lado cuando la
   imagen llegó.
3. **Una imagen guardada a otra escala no se muestra al conmutar.** Si la
   página del lado nuevo no tiene imagen a la escala del zoom, el visor sigue
   mostrando la imagen del lado anterior hasta que llega la nueva, y recién
   ahí la cambia. Página por página.
4. **La espera tiene tope.** Si la imagen nueva no llega en 500 ms, se muestra
   lo que haya, como hoy. Una página que falla no deja al visor mostrando el
   lado equivocado.
5. **Mientras una página espera, no admite selección.** La capa de selección
   y de resaltado de esa página queda inerte: la imagen que se ve es del otro
   lado.
6. **El pedido de imagen lleva siempre su escala.** En el cliente, pedir un
   preview sin escala deja de compilar. Un pedido sin escala fue la causa de
   la imagen borrosa después de reanalizar.

Con el punto 1, el caso común es instantáneo: al conmutar, la imagen del otro
lado ya está a la escala correcta. Los puntos 3 y 4 cubren lo que el punto 1
no alcanza: conmutar antes de que termine el dibujo en segundo plano, y las
páginas a las que se llegó por scroll mirando un solo lado.

## Costos

- **Cada zoom dibuja el doble de páginas**: las montadas, de los dos lados.
  Son pocas, porque el visor monta solo las páginas cercanas a la que se ve.
  El caché de imágenes tiene su tope de memoria de siempre.
- **En los casos que cubre el punto 3, el cambio de vista tarda** lo que
  tarda en llegar la imagen, con el tope de medio segundo. Antes era
  inmediato y borroso.
- El visor guarda una escala por imagen: un número por lado y por página.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Dejarlo como está | El mantenedor pidió eliminar el instante borroso |
| Solo esperar la imagen nítida (puntos 3 y 4, sin el 1) | Sin costo de dibujo, pero cada primer cambio de vista después de un zoom tardaría esos 150 a 200 ms |
| Dibujar siempre los dos lados, también al scrollear | Es lo que ADR-056 sacó: la mitad del trabajo de dibujo en un scroll sería para páginas que nadie mira |
| Que el evento de la imagen lleve su escala | Cambio de contrato que ADR-189 ya descartó; el visor puede saberlo sin eso |
| Que el motor conozca la escala del otro lado sin dibujarlo | Corrige las imágenes que nacen de una edición, no las de un zoom. Exige un contrato nuevo |

## Plan y validación

Primero `React_Client.md` §7 y `Components.md` (visor). Después el código, en
`apps/react-client` solo, y sus E2E en commit propio.

Pruebas, sobre la imagen real que dibuja el visor:

- después de un zoom, conmutar no dibuja nunca una imagen a la escala vieja:
  la primera imagen del lado nuevo que se pinta ya está a la escala del zoom;
- lo mismo después de editar una entidad, cambiar un modo, agregar una
  entidad, deshacer y reanalizar;
- conmutar de inmediato tras un zoom, antes de que llegue el otro lado: se
  mantiene la imagen anterior y después aparece la nítida;
- una página a la que se llegó por scroll mirando un solo lado: igual;
- el tope de 500 ms: con el dibujo demorado a propósito, el visor termina
  mostrando el lado pedido;
- un scroll no pide el lado que no se mira;
- los E2E existentes de zoom, de interacción anonimizada y del repintado
  siguen en verde.

El costo del punto 1 no se mide aparte: el mantenedor lo consideró
innecesario, por la cantidad de páginas en juego. Las suites de rendimiento y
de memoria de siempre siguen corriendo antes de un release.
