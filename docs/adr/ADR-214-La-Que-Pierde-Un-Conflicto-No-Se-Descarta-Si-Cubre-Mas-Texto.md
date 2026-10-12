<!-- CONTEXT: scope=adr-aceptado | dependencias=core/Grouping_Engine.md,core/Contracts.md,architecture/03_Data_Model.md,adr/ADR-107-El-Conflicto-Se-Mide-Sobre-Los-Fragmentos.md,adr/ADR-117-Una-Ocurrencia-Contenida-No-Aporta-Tinta.md,adr/ADR-174-Un-Agregado-Manual-Que-Choca-Se-Resuelve-En-El-Momento.md,adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md,roadmap/hardening/Confianza_1.0.x_Plan.md | audiencia=humanos+IA | fase=12 -->

# ADR-214 — La que pierde un conflicto no se descarta si cubre más texto

- **Estado:** Aceptado por el mantenedor el 2026-10-07, al ver el caso
  medido: eligió arreglarlo en la branch de Confianza.
- **Fecha:** 2026-10-07.
- **Alcance:** `grouping-engine`, conflictos `overlap` y `disagree` entre
  detecciones automáticas. No cambia ningún contrato.

## Contexto

Cuando dos detecciones de distinto tipo se superponen más de la mitad de la
más chica, el agrupador lo trata como un conflicto y elige una ganadora
(`Grouping_Engine.md` §13, casos 7 y 8). Entre el modelo de nombres y un
patrón gana siempre el patrón.

Lo que pasa después depende del orden de llegada:

- si **gana la que llega**, se agrupa y la anterior sigue en su grupo:
  quedan las dos;
- si **pierde la que llega**, se descarta entera.

Los patrones corren antes que el modelo, así que la que llega y pierde es
casi siempre la del modelo. Y se descarta aunque cubra más texto que la del
patrón.

**El caso medido** (2026-10-07, con el modelo real, sobre 12 oraciones
sintéticas, dos corridas iguales). En texto en mayúsculas, el patrón de
patente vieja toma la última palabra de tres letras de una calle y una
altura de tres dígitos:

| Oración | El modelo | El patrón | Lo que queda | A la vista |
|---|---|---|---|---|
| «CON DOMICILIO EN AVENIDA DEL MAR 450 DE ESTA CIUDAD.» | dirección «AVENIDA DEL MAR 450» | patente «MAR 450» | solo la patente | «AVENIDA DEL» |
| «CON DOMICILIO EN CALLE DEL SOL 123.» | dirección «CALLE DEL SOL 123» | patente «SOL 123» | solo la patente | «CALLE DEL» |
| «SE DOMICILIA EN PASAJE LA PAZ 780, PLANTA BAJA.» | dirección «LA PAZ 780» | patente «PAZ 780» | solo la patente | «LA» |

Pasó en 5 de las 12 oraciones: las tres de la tabla, «EL DEMANDADO VIVE EN
AVENIDA DEL MAR 450.» y «CON DOMICILIO EN AVENIDA DEL MAR 450, DOMINIO ABC
123.». En minúsculas no pasa: el patrón pide mayúsculas.

Las otras siete, de control:

| Oración | Resultado, igual antes y después |
|---|---|
| «CON DOMICILIO EN AVENIDA SAN LUIS 450.» | dirección entera; no hay patente |
| «CON DOMICILIO EN AVENIDA DEL MAR 4500.» | dirección entera; no hay patente |
| «CON DOMICILIO EN MAIPU 1434 DE ESTA CIUDAD.» | ninguna detección |
| «CON DOMICILIO EN BELGRANO 1950.» | ninguna detección |
| «Con domicilio en Avenida del Mar 450 de esta ciudad.» | dirección entera; no hay patente |
| «Con domicilio en calle del Sol 123.» | dirección entera; no hay patente |
| «El vehículo dominio MAR 450 quedó secuestrado.» | solo la patente, sin conflicto |

Cada oración va sola en una página, entre los dos renglones de relleno del
arnés de M-D1. No quedó un arnés versionado para esta medición.

- **Es anterior a ADR-212.** Por las cajas medidas, en 2 de esas 5 la
  dirección sin la altura ya superaba la mitad de la patente y se
  descartaba igual: el defecto está en la 1.0.
- **ADR-212 lo vuelve seguro.** Al sumar la altura, la dirección contiene
  entera a la patente y el conflicto se da siempre. En las otras 3 de las 5,
  la extensión lo provoca o lo termina de inclinar.
- ADR-212 decía que este choque «lo resuelve el mecanismo de conflictos de
  siempre». El revisor mostró que eso deja la calle a la vista.

## Decisión

1. **Una detección automática que pierde un conflicto se descarta solo si
   queda contenida entera en la que le ganó.** Contenida es el criterio de
   ADR-117: cada rectángulo que pinta la perdedora cae dentro de alguno de
   los de la ganadora.
2. **Si cubre texto que la ganadora no cubre, se agrupa igual.** Quedan las
   dos detecciones, cada una en su grupo, como ya pasa cuando gana la que
   llega.
3. **El conflicto se sigue emitiendo**, igual que hoy, con la misma ganadora
   y el mismo tipo resuelto. Lo único que cambia es que la perdedora no
   desaparece.
4. **Vale para `overlap` y para `disagree`.** El descarte de una perdedora
   que cubre más texto deja ese texto a la vista en los dos.
5. **Los agregados manuales no cambian.** Un agregado manual que pierde
   queda retenido a la espera del usuario (ADR-174), contenido o no.

No cambia el umbral que define un conflicto, ni quién gana, ni el evento.

## Por qué así

- Descartar una detección solo es inocuo cuando otra ya tapa todo su texto.
  Es la misma idea de ADR-117, llevada a tipos distintos.
- Para una pareja en que una cubre más texto que la otra, el resultado deja
  de depender del orden: hoy deja dos grupos o uno según cuál llegue
  primero. Con dos cajas idénticas sigue dependiendo, como antes: si llega
  primero la que pierde, quedan las dos. No cambia lo que se tapa.
- Las cajas de las dos fuentes salen de las mismas palabras de la página.
  Dos detecciones sobre el mismo texto tienen la misma caja, y ahí no cambia
  nada: la perdedora está contenida y se descarta.

## Lo que cambia para el usuario

- En el caso medido quedan dos grupos: la dirección «AVENIDA DEL MAR 450» y
  la patente «MAR 450». Todo el texto queda tapado. En la vista anonimizada
  los dos reemplazos se superponen, como ya pasa hoy con dos detecciones
  que se pisan menos de la mitad.
- El grupo de la ganadora sigue mostrando el aviso de conflicto.
- **Puede aparecer más ruido en la lista.** Una detección del modelo que
  antes se descartaba por pisar un dato de un patrón ahora queda, si abarca
  alguna palabra más. Es tapar de más, no de menos, y el usuario la puede
  desactivar.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Dejarlo escrito como límite | El mantenedor eligió arreglarlo: deja texto a la vista que un detector había marcado |
| Que `ner-engine` no extienda cuando hay un patrón encima | Los motores no se conocen entre sí, y no arregla el caso que ya existe sin la extensión |
| Subir el umbral del conflicto, o medirlo contra la más grande | Cambia qué es un conflicto en todos los casos. Una perdedora que sobresale por una palabra corta se seguiría descartando |
| Recortar la perdedora a la parte que no pisa | Inventa una detección que ningún detector emitió, con un valor y una caja nuevos |
| Sacar el patrón de patente vieja en mayúsculas | Es un dato real en un expediente. El defecto es del descarte, no del patrón |

## Consecuencias

- Deja de quedar a la vista el texto de una detección que pierde contra otra
  más corta.
- Cambia la detección: es un parche (`Roadmap_1.x.md` §1), y las notas de la
  versión dicen que el mismo documento puede dar un resultado distinto.
- Puede haber más grupos en la lista y más reemplazos superpuestos.
- Ruido conocido, sin efecto sobre lo que se tapa ni sobre el export:
  cada vez que se vuelve a detectar una página, la pareja suma otro aviso
  de conflicto resuelto sobre el grupo de la ganadora; si se elimina el
  grupo de la perdedora, el aviso queda en el de la ganadora; y resolver el
  conflicto con el tipo de la perdedora deja dos grupos del mismo tipo, uno
  dentro del otro, que se pueden fusionar.
- Con dos reemplazos superpuestos, el repintado de línea no se activa para
  ninguno de los dos (ADR-210, enmienda del mismo día): la etiqueta se
  achica.

## Plan y validación

1. `Grouping_Engine.md`: nota de versión, casos 7 y 8, caso nuevo, tests de
   §14 con sus nombres e ítem de §15.
2. El código, en `grouping-engine` solo.
3. Validación con el modelo real: las 12 oraciones de la medición vuelven a
   pasar por la aplicación. Se espera que en las 5 quede la dirección, y
   ninguna palabra de la calle a la vista.
4. La línea de base de calidad se vuelve a medir: ninguna entidad cubierta
   puede dejar de estarlo, y se anota cuántos falsos positivos suma.

**Validado el 2026-10-07**, con el modelo real y el cambio implementado.

- Las 12 oraciones, dos corridas iguales: en las 5 del caso quedan la
  dirección y la patente, con un conflicto `disagree` por página resuelto
  como patente. Ninguna palabra marcada por un detector queda fuera de un
  grupo habilitado. Las otras 7 oraciones no cambian.
- Línea de base de calidad: 78 de 78 entidades cubiertas y los mismos
  falsos positivos que antes del cambio (precisión 78 de 96). En el conjunto
  de referencia el cambio no suma ruido.
- Visto en la validación: «AVENIDA DEL MAR 4500» y «AVENIDA DEL MAR 450»
  quedan en un mismo grupo, por la agrupación difusa de direcciones de
  siempre. Antes no se veía porque la segunda se descartaba.
