<!-- CONTEXT: scope=menus-entidades-visibles | dependencias=ui/Components.md,roadmap/interaccion/Mejoras_Interaccion_2026-10-05.md | audiencia=planificador+implementador+revisor | fase=fix-post-merge-53 -->

# ADR-207: los menús de entidades se mantienen dentro del área visible

**Estado:** Adoptado por el planificador para el fix solicitado después de #53 — 2026-10-06.

## Contexto

El E2E de colocación del menú de acciones falla tras integrar #53 en
develop. En Electron Windows se reproduce con contenido de 1024 × 700:
el pie de sugerencia envuelve su texto, reduce la lista y tapa la última
opción. El menú termina en y=633,5 y la lista en y=608,25. Ninguno de los
lados del disparador admite el menú entero. Elegir el lado con más espacio
cumple la regla de dirección, pero deja una acción inaccesible.

Las dimensiones efectivas del runner macOS no están disponibles en los
artefactos de la corrida. El caso reducido reproduce el mismo fallo de
alcanzabilidad y requiere una corrección de producto, no agrandar el
viewport de la prueba ni retirar su comprobación de hit testing.

## Decisión

1. Mantener la elección de dirección: abajo si cabe, arriba si cabe allí,
   y el lado con más espacio cuando no cabe en ninguno (empate: abajo).
2. Acotar además la posición vertical al área visible: intersección de
   ventana y ancestros que recortan. Cuando el menú cabe en esa área total,
   desplazarlo lo mínimo necesario para que quede entero dentro. En el caso
   sin espacio a ambos lados, ese desplazamiento puede solapar el disparador.
   No desplazar filas ni modificar el scroll de la lista.
3. Si el menú supera el alto del área visible total, limitar su alto a esa
   área y permitir scroll dentro del menú. Todas sus opciones siguen
   disponibles con mouse y Tab; no se necesita desplazar la lista externa.
4. Compartir el cálculo entre GroupContextMenu y ModeSelectMenu, sin
   dependencias nuevas, portal, cambios de roles accesibles ni contratos Core.
   Medir alto intrínseco con las opciones condicionales y evitar que el alto
   limitado se confunda con el intrínseco al recalcular.
5. Recalcular ante cambios de tamaño, scroll y reflow del área que recorta.
   Retirar observadores y listeners al cerrar o desmontar. Conservar cierre
   por click fuera, Escape y selección, y el resaltado del grupo abierto.

## Validación

Reglas puras: dirección existente, desplazamiento mínimo en ambos sentidos,
límites desplazados, empate, área menor que el menú y límites degenerados.
Electron: reproducir 1024 × 700 y una ventana amplia; verificar cada opción
alcanzable mediante elementFromPoint, menú contenido, sin scroll de la lista,
acción real y cierre. Incluir arriba/abajo, menú de modos, resize mientras está
abierto y fallback de scroll interno. No aflojar los checks existentes.

El fix se revisa por Sol y se publica en un PR nuevo hacia develop.

Los tamaños se solicitan a la ventana nativa y se verifica el viewport contra
`getContentBounds()`: el SO puede acotarlos al display, especialmente en macOS,
donde `enableLargerThanScreen` vale false por defecto. La ventana amplia se
solicita dentro del área de trabajo real. Cuando el alto intrínseco cabe en
los límites medidos, se exige menú sin scroll interno y todos los centros
alcanzables; si excede esos límites, se recorren todas las opciones por foco
y hit testing dentro del menú. Ninguna opción se omite de las aserciones.
El reflow de un área restringida se prueba además de los tamaños nativos.

## Referencias

- [Corrida fallida](https://github.com/sgiambelluca/Anonly/actions/runs/37502791346).
- [Límites nativos de las ventanas Electron](https://github.com/electron/electron/blob/main/docs/api/structures/base-window-options.md).
- ui/Components.md §3.3, §3.4 y §3.5.
- roadmap/interaccion/Mejoras_Interaccion_2026-10-05.md.
