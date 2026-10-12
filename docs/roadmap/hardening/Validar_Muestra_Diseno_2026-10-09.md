<!-- CONTEXT: scope=diseno-validar-muestra | dependencias=roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/Roadmap_1.x.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-012-Replacement-Modes.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md,core/Contracts.md,ui/Components.md | audiencia=humanos+IA | fase=12 -->

# Validar muestra — propuesta retirada

**Estado: RETIRADA DEL ROADMAP el 2026-10-11, por decisión del mantenedor.**
No se desarrolla la función. Se prioriza la revisión manual del documento y
la configuración de sus entidades; no se añade verificación automática
post-export. Esto reemplaza la decisión de ofrecer un botón y cancela las
consultas de flujo, comparación y costo. No hay ADR, contrato ni tarea de
implementación pendiente para esta propuesta.

Todo lo que sigue es el **registro histórico de la propuesta y del instrumento
de medición**, sin instrucciones de trabajo vigentes. M-V1 y el diagnóstico
se conservan en el [informe de lectura](../mediciones/transversal/Validar_Muestra_Costo_Lectura_2026-10-10.md),
con sus resultados y limitaciones; no acreditan la existencia de la función.

## Qué se verifica

La copia anonimizada que acaba de generarse, en memoria. El resultado pertenece
a ese export y a su revisión (ADR-205), con una instantánea de los datos que
se quiso tapar. No se vuelve a detectar el documento original ni se cambia
la sesión de edición para verificarlo.

La propuesta es leer todas las páginas del export. «Muestra» es el nombre de
la función ya elegido en el plan, no una selección aleatoria de páginas.
Si se quisiera limitarla a una selección, habría que definir qué páginas
entran y mostrar explícitamente el alcance del resultado.

La verificación busca valores de las ocurrencias que se taparon, no solo el
valor canónico de cada grupo: una variante puede ser distinta del canónico.
Los reemplazos personalizados que dejan parte del valor a la vista por
decisión del usuario y las ocurrencias desactivadas necesitan un tratamiento
explícito. No se
puede anunciar «sin hallazgos» contando esas exclusiones como verificadas.

Un resultado sin coincidencias significa que esta lectura no encontró los
valores buscados. No acredita que la detección original haya encontrado
todo ni que una persona no pueda leer un dato que el OCR no reconoce.

## Propuesta de interacción

| Estado | Texto principal propuesto | Acciones |
| --- | --- | --- |
| Export generado | «Exportación completa»; nombre y tamaño, como hoy | Descargar; Validar muestra; Exportar otro |
| Leyendo | «Verificando la copia anonimizada»; página terminada / total | Cancelar verificación; Descargar |
| Sin coincidencias | «No se encontraron los valores buscados»; páginas leídas y exclusiones | Descargar; Volver al documento |
| Posibles coincidencias | «Hay datos para revisar»; lista por página, con valor buscado y lectura encontrada | Revisar página; Volver al documento; Descargar |
| Lectura incompleta | «No se pudo verificar todo el documento»; páginas pendientes o ilegibles | Reintentar; Volver al documento; Descargar |
| Cancelada | «Verificación cancelada»; alcance parcial, sin veredicto de éxito | Verificar de nuevo; Descargar |
| Se editó después del export | «Esta copia corresponde a una versión anterior» | Volver al documento; Generar otra copia |

La lectura de los valores y los hallazgos queda solo en memoria. No se envía
ni se escribe un reporte con datos del documento. Las pantallas conservan
las salidas de descarga ya existentes.

**Propuesta sobre el archivo:** un hallazgo no modifica ni borra el PDF ya
generado. Corregir requiere volver al documento y exportar otra copia.
Una verificación tampoco debe afirmar que el archivo descargado en disco
coincide con los bytes que mantiene la aplicación: verifica estos últimos.

**Propuesta para documentos largos:** mismo alcance y progreso real por
página, con cancelación; sin iniciar automáticamente ni añadir un límite
de páginas oculto. La medición M-V1 determina si hace falta otra alternativa.

## Comparación: propuesta y decisiones pendientes

No se propone una distancia difusa general ni un porcentaje arbitrario de
similitud. Una coincidencia es un posible hallazgo para revisar, no una
corrección automática.

- Texto: normalización explícita de mayúsculas, diacríticos y espacios.
- Identificadores: comparación de la secuencia significativa con separadores
  documentados; cualquier tolerancia a confusiones del OCR lleva ejemplos
  positivos y negativos antes de adoptarse.
- Valores cortos y partes de identificadores: la búsqueda de fragmentos puede
  coincidir con texto vecino. La longitud mínima y el contexto no se fijan
  sin corpus y decisión del mantenedor.
- Los cuatro modos de reemplazo entran en el alcance. `mask` conserva el
  formato, no el valor (ADR-012): no se excluye un grupo solo por usarlo.
- Valores que un reemplazo personalizado conserva intencionalmente y
  entidades desactivadas: declarar el alcance de su tratamiento y probar
  que una coincidencia permitida no oculta otra ocurrencia que sí debía
  taparse. No usar una lista global de valores permitidos que silencie
  hallazgos en otras páginas o ubicaciones.
- Una página ilegible o fallida no se transforma en «sin coincidencias».

Estas reglas son una propuesta para decidir con el lienzo y M-V1. No autorizan
todavía un nuevo contrato público.

### Casos inventados para decidir la comparación

El corpus de decisión separa coincidencias completas, fragmentos y exclusiones.
Los identificadores y nombres de esta tabla son ficticios. Las clasificaciones
son propuestas para discutir, no umbrales aceptados ni resultados medidos.

| Caso | Valor que se quiso tapar | Lectura de la copia | Tratamiento propuesto o decisión pendiente |
| --- | --- | --- | --- |
| C01 | `38.471.629` | `38471629` | Posible coincidencia completa tras normalizar separadores de DNI |
| C02 | `38.471.629` | `38 471 629` | Igual que C01, con separadores explícitamente admitidos |
| C03 | `José Álvarez` | `JOSE ALVAREZ` | Posible coincidencia completa tras normalizar escritura |
| C04 | `Av. Pueyrredón 1999` | `AV. PUEYRREDON 1999` | Posible coincidencia completa; no quitar puntuación arbitraria de cualquier texto |
| C05 | `correo@ejemplo.test` | `correo @ ejemplo.test` | Definir qué separadores del OCR se admiten para email, sin convertir cualquier texto separado en un email |
| C06 | `38.471.629` | `3847` | Fragmento significativo candidato; longitud y contexto pendientes |
| C07 | `38.471.629` | `1629` | Igual que C06 para un fragmento del final |
| C08 | `38.471.629` | `38` en una enumeración pública | No adoptar fragmentos de dos dígitos sin una regla decidida que distinga contexto |
| C09 | `38.471.629` | `3847` dentro de otro identificador público | Candidato a falso positivo de fragmentos; resolver límites y contexto antes del umbral |
| C10 | `38.471.629` | `3847I629` | Confusión `1/I`: proponer ejemplos positivos y negativos antes de permitir sustituciones |
| C11 | `Ana` | `ana` dentro de `semana` | Comparar palabras o límites acordados; no usar una subcadena irrestricta para nombres cortos |
| C12 | `Ana` | `Ana` como vecina pública del dato tapado | Una coincidencia de texto no prueba que la misma ocurrencia escapó; mostrar como posible hallazgo y decidir el tratamiento de homónimos |
| C13 | Canónico `José Álvarez`, ocurrencia `J. Álvarez` | `J. ALVAREZ` | Buscar también el valor de la ocurrencia; usar solo el canónico perdería el caso |
| C14 | `38.471.629`, modo `mask` | `XX.XXX.XXX` | El formato conservado por el modo no es una coincidencia del valor original |
| C15 | `38.471.629`, modo `mask` | `38.471.629` | El modo no excluye el grupo: el original completo sigue siendo un posible hallazgo |
| C16 | Valor conservado a propósito en página 1 | El mismo valor aparece sin tapar en página 8 | Una excepción de la primera ubicación no puede silenciar la segunda; hace falta alcance por ocurrencia o una advertencia explícita |
| C17 | Ocurrencia desactivada | Su valor sigue visible | Declarar que no se quiso tapar; no contarla entre los valores comprobados ni ocultar otras ocurrencias activas del mismo valor |
| C18 | Cualquier valor objetivo | Página sin lectura o cancelada | Resultado incompleto o cancelado; nunca «sin coincidencias» para el documento entero |

El gate de ADR-148 tiene objetivos y reglas por fixture conocidos de antemano.
En la función los objetivos vienen de la sesión y pueden ser cortos,
homónimos o reemplazos personalizados. Sus reglas no se trasladan como un
comparador general sin resolver los casos de esta tabla. El resultado debe
mostrar el alcance que efectivamente leyó y buscó.

## Opción inicial concreta para la comparación (propuesta, 2026-10-10)

Esta opción se presenta para decidir junto con M-V1; no es un comparador
adoptado ni autoriza código. Busca **valores completos** de cada ocurrencia
activa que participó del export, incluidos sus valores distintos del
canónico, en todos los modos de reemplazo.

- Para texto, iguala mayúsculas, diacríticos y secuencias de espacios,
  conservando la puntuación. Compara con límites de palabra: «Ana» dentro
  de «semana» no coincide. Una palabra completa homónima sí se muestra como
  posible coincidencia, sin declarar que escapó la misma ocurrencia.
- Para DNI, CUIT, teléfono y tarjeta, permite los separadores de cada formato
  explícitamente enumerados en el futuro ADR; compara la secuencia completa
  y sus límites. Para DNI, los ejemplos admitidos son puntos y espacios.
  No permite transformar letras en dígitos ni buscar fragmentos del número.
- Para email, admite espacios del OCR alrededor de `@` y de los puntos,
  conservando completos el nombre y el dominio. Las demás formas permanecen
  en la regla de texto; IBAN, matrícula y patente requieren ejemplos propios
  antes de ampliar su normalización.
- Los reemplazos personalizados también participan. Una coincidencia que
  el usuario conservó a propósito se muestra para revisar; no se crea una
  lista global de valores permitidos que pueda silenciar otra ubicación.
  Las ocurrencias desactivadas se excluyen como objetivos y se cuentan
  aparte. Si su valor también pertenece a una ocurrencia activa, sigue
  buscándose y cualquier coincidencia se informa como posible.
- Sin objetivos, el resultado dice que no hay valores para buscar. Con
  páginas fallidas, ilegibles o canceladas, conserva el alcance incompleto.
  «Sin coincidencias» solo describe los valores completos efectivamente
  buscados en las páginas que se leyeron; la pantalla declara ese alcance.

Con esta opción, C01–C05 y C13 son coincidencias normalizadas; C11 no
coincide, C12 requiere revisión, C14 no coincide y C15 sí. C06–C10 quedan
fuera de la búsqueda completa: podrían contener restos o errores de OCR
que esta primera comparación no encontraría. C16 no silencia la otra
ubicación, C17 no aporta un objetivo desactivado y C18 impide un resultado
completo. Ampliar a fragmentos o confusiones del OCR necesita una regla y
controles acordados; no se fija un porcentaje o longitud por inferencia.

Las consultas del 2026-10-10 incluían todas las páginas, progreso, cancelación,
descarga, corrección mediante otro export, comparación de valores y costo
con el original abierto. **Quedaron canceladas por el retiro del 2026-10-11.**
La decisión anterior de ofrecer un botón también quedó reemplazada; no se
requiere respuesta ni desarrollo para esta propuesta.

## M-V1 — instrumento y límites de la evidencia

Se mantiene la matriz del frente 4: documentos digitales y escaneados de
10 y 50 páginas, niveles `low` y `medium`, tres repeticiones en frío. A ella
se agregan, informados aparte y primero en los resultados, el escaneo real
R1 y el digital real R4 ya disponibles por `ANONLY_REAL_DOC_*`. Sus tamaños
son 20 y 51 páginas: no sustituyen las filas de 10 y 50 ni se recortan para
hacerlos coincidir.

La matriz suma 36 corridas (seis documentos, dos niveles, tres
repeticiones). Los escaneos sintéticos de 10 y 50 páginas se generan con
el texto normativo existente y escala 3 (216 dpi), sin cambiar su contenido.
Para que el hash sea estable, el arnés fija solo la metadata variable de
los PDFs sintéticos cuya generación la deja variar (digital de 10 páginas
y escaneos). Lo hace en memoria, fuera de la ventana medida, e informa
los campos y valores fijos; el hash corresponde a los bytes importados.
No modifica los helpers, el caché, las imágenes ni los documentos reales.
Se conservan los defaults actuales de export:
JPEG a 150 dpi, calidad 0,92, reemplazos por etiquetas y sin leyenda. Si el
producto pide cubrir una página no leída, se confirma esa cobertura y se
registra cuántas páginas quedaron cubiertas; no se omite el aviso ni se
interpreta una página cubierta como una lectura correcta del original.

**Preparación de conflictos del benchmark (2026-10-10).** El primer intento
real R1 llegó a Ready con tres conflictos y el producto bloqueó correctamente
la exportación (ADR-176). El intento se interrumpe: su checkpoint no aporta
costo de lectura de la copia. Para preparar el PDF de medición, el arnés
confirma por UI las opciones que el producto ya trae preseleccionadas
(ADR-083 y ADR-106), sin cambiar radios, tipos, grafías ni modos de reemplazo.
Este paso ocurre después de medir la importación y antes de pedir export;
se informa su duración y cantidad aparte, sin simular tiempo de revisión humana.
No acredita que esos candidatos sean correctos ni es una decisión del usuario
sobre su documento. Solo prepara una copia reproducible para medir su lectura.
Se verifica en memoria que no cambien tipo vigente, valor canónico ni modos
de los grupos, incluidos miembros, reemplazos, activación y demás datos
semánticos; solo deben cambiar los estados de resolución y sus metadatos
(`resolvedType` coincidente con el tipo vigente, `updatedAt` del grupo).
Los registros
guardan cantidades y resultados de esas comprobaciones, nunca valores reales.
Conflictos manuales retenidos o defaults inconsistentes quedan bloqueados y
se informan por separado: no se elimina una entidad ni se fabrica una elección.
El arnés tiene un límite acotado del recorrido, exige que la cantidad pendiente
disminuya y que el botón Exportar se habilite; no espera el timeout de una
importación larga sobre un botón deshabilitado. Esta adaptación cambia la
identidad del instrumento y requiere una nueva carpeta de campaña.

La lectura offline de un crudo histórico sin el campo de preparación lo
proyecta como no registrado (`null`), nunca como preparado. Se conserva el
intento fallido y su diagnóstico; un éxito antiguo sin esta evidencia no
acredita una corrida del instrumento nuevo. El control de opciones verifica
los radios realmente presentes según el diálogo: con una sola grafía no
hay una elección de escritura que inventar.

Por celda y repetición:

1. Importar el original con la aplicación empaquetada y registrar su tiempo
   hasta `Ready` y el pico M2 con el instrumento vigente.
2. Exportarlo con las opciones de producto y conservar los bytes en memoria.
   Registrar duración, tamaño y páginas; una exportación fallida es un
   resultado que se informa.
3. Cerrar el original, abrir una instancia fría y analizar esos bytes.
   Registrar tiempo hasta `Ready`, pico M2, páginas leídas, avisos y fallas.

La reimportación ejecuta además detección y agrupación. Es una aproximación
al costo de la futura verificación, no una medida de un verificador que
todavía no existe. El informe separa tiempo OCR del total si el instrumento
lo permite y explica esa diferencia. La aplicación mantiene en memoria el
export para verificarlo: también hay que declarar si el instrumento incluye
ese buffer o mide solo los procesos de Electron.

M-V1 cierra el original antes de abrir la copia, mientras que la función
propuesta conserva la sesión de edición. Por eso no mide el pico de una
verificación con el original todavía abierto ni el costo de la comparación
futura. Antes de cerrar el frente implementado se debe medir ese flujo real
con el original retenido, incluidos sus buffers, tiempos, avisos y
cancelación. No se convierte la reimportación en un presupuesto garantizado
de la nueva función ni se deduce que sea una cota de memoria.

Una importación, exportación o lectura que falla es un resultado del
producto y se informa por etapa. No entra en los tiempos de corridas
exitosas ni se convierte en un costo de verificación satisfactoria.
Incoherencias de los colectores, faltas de identidad o suspensión son
problemas del instrumento: dejan la campaña incompleta y sus corridas se
repiten. Los datos de una etapa terminada pueden conservarse como
checkpoint agregado, pero no se simula retomar bytes de un export perdido:
al repetir una celda se empieza desde el original en una instancia fría.

**Adaptación del instrumento (2026-10-10).** La exportación por UI llega a
`EXPORT_FINISHED`, pero `fetch(blobUrl)` desde el renderer falla bajo la CSP
del shell. El probe de lectura directa del UUID de la URL mediante CDP
también falló; no se lo trata como lectura válida. Para acceder al mismo
Blob, el arnés instala después de Ready y antes del export un observador
de `URL.createObjectURL`: llama a la función original sin modificar
argumentos ni resultado, retiene una referencia solo a los Blob PDF y
busca el que corresponde al href exacto del export terminado. Lee su
`arrayBuffer` en memoria, fuera de las ventanas de importación medidas;
comprueba tamaño, hash y páginas. Restaura la función y libera referencias
en `finally`. Se prueba transparencia, bytes binarios y limpieza ante fallo
antes de repetir smoke. No se cambia CSP ni fuentes de producto, no se
descarga y no se crea un archivo derivado. Esta retención es parte del
instrumento de exportación; no se presenta como costo medido del futuro
verificador con el original abierto.

Los sintéticos tienen hashes y generación estable. Los reales entran solo
por variables de entorno: ningún nombre, ruta, texto, imagen ni PDF derivado
sale al repositorio o a los registros. Los crudos llevan identificadores
neutros, hashes, cantidades, tiempos y memoria. No hay capturas, trazas ni
vídeos de documentos reales.

Las corridas son reanudables, conservan la identidad de producto, arnés y
build, y no se ejecutan junto con M-O3 ni otra suite pesada. Las corridas
con el producto sin commitear se declaran provisionales, como las campañas
anteriores.

La completitud se exige contra las 36 corridas del plan, incluidos los
reales; la ausencia de una variable no reduce ese universo. La retoma
acepta solo resultados de una tanda con identidad íntegra y guarda de
suspensión cerrada como válida, con detección confirmada al abrirla y
cerrarla. Si la consulta deja de estar disponible, la tanda conserva sus
registros pero no aporta costos comparables ni completitud hasta repetirla.
La prevención de suspensión sigue siendo de mejor esfuerzo y se informa
como salvedad: perderla no invalida por sí solo una tanda cuya detección
confirmó ausencia de eventos. Una tanda interrumpida que no llegó a
cerrar esa guarda tampoco aporta corridas completas.

El mecanismo de importación en memoria de Playwright rechaza payloads de
50 MiB o más. Si una entrada o copia alcanza ese límite, se informa como
limitación del instrumento y la campaña queda incompleta; no se resuelve
escribiendo a disco un documento real o su derivado. Este límite no se
presenta como una restricción del producto.

## Antes de implementar

Con M-V1 completo, el mantenedor decide alcance, acciones ante hallazgos,
cancelación, documentos largos y comparación. Entonces el planificador
escribe el ADR y actualiza Contracts, sistema de eventos y specs afectados
antes de entregar tareas de implementación. La revisión del lote permanece
al final; no se commitea antes de su aprobación.
