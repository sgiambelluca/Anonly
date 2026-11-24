<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Word_Limpio_Alineacion_2026-11-24.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-238-El-Formato-De-Origen-Se-Reconoce-Por-El-Contenido-Y-La-Salida-Se-Elige-Al-Exportar.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,adr/ADR-242-Un-Office-Con-Contrasena-Se-Descifra-Antes-De-Convertir.md,core/Contracts.md,core/Convert_Engine.md,core/Export_Engine.md,core/Render_Engine.md,core/Orchestrator.md,architecture/08_Security_Model.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-243 — El Word se limpia al entrar, y el Word limpio sale de ese paquete

- **Estado**: Borrador del planificador. Espera la medición de escritura
  (`Plan_1.2.md` §8.9) y después la decisión del mantenedor.
- **Fecha**: 2026-11-24.
- **Decidido por**: el planificador, sobre las decisiones del mantenedor de
  `Plan_1.2.md` §3.
- **Origen**: `Plan_1.2.md` §6.2 y §6.3, y el mapa de ADR de §10 («Qué
  significa "no recuperable" en un Word, y su gate»).
- **Enmienda**: ADR-240 §5 (el preproceso de un Word), ADR-242 (qué bytes
  guarda la app) y ADR-009 (la garantía del export, para `output: "docx"`).

## Contexto

### 1. Lo que decidió el mantenedor

Todo está en `Plan_1.2.md` §3:

- Cuando entra un Word, sale **el mismo Word, limpio**: conserva el diseño,
  los estilos y las tablas, con los datos reemplazados. Se rearma con una
  lista cerrada de partes y se borra lo que esconde datos.
- **Un Word entra a la app solo con su última versión.** Nada del historial
  llega a la vista ni a ninguna salida. En palabras del mantenedor: el
  documento «no tiene que tener metadata del original destapado, eso es una
  de las promesas de la app».
- **Una detección que no se puede ubicar en el XML no puede quedar en
  claro**: el Word no se exporta y se ofrece el PDF.
- **El texto del Word que LibreOffice no dibuja se muestra en la vista
  previa**, en páginas al final del documento. Los detectores buscan ahí, y
  lo que se tapa se reemplaza en su lugar del Word limpio. Esas páginas no
  salen en el PDF.
- **Las imágenes adentro de un Word pasan por OCR**, y en el Word limpio se
  reemplazan por su versión tapada.

### 2. Lo que midió el spike de alineación

`formatos/Word_Limpio_Alineacion_2026-11-24.md` (`Plan_1.2.md` §8.8):

- Un lector y un alineador propios, sin dependencias, ubican en un solo
  lugar del XML el 91 % de las palabras de las páginas, y 230 de 254 datos
  con forma de DNI, CUIT o correo. Ninguno de esos datos quedó sin ubicar.
- El 4,1 % de los caracteres del XML no tiene par en las páginas. Buena
  parte es texto que **ninguna página puede mostrar**: encabezados de un
  tipo que no se usa, notas sin referencia, el valor guardado de un campo
  que LibreOffice recalcula, el `mc:Fallback`.
- Ese texto sigue adentro del `.docx`. Si el Word limpio se arma desde el
  original, viaja aunque la vista no lo muestre.

### 3. El problema de limpiar al exportar

Si la app guarda el original y lo limpia recién al exportar, la vista
previa muestra una cosa y el Word limpio lleva otra. La diferencia es todo
lo que la limpieza cambia: los campos, lo oculto, lo que no se usa. Y el
original, con su historial y sus metadatos, queda en la memoria de la app
toda la sesión.

## Decisión

### 1. El Word se limpia al entrar

Cuando entra un `.docx`, el Convert Engine arma un **paquete limpio** antes
de convertir. Ese paquete es lo que convierte LibreOffice, lo que guarda la
app y la base del Word limpio. **El original se descarta** apenas está el
paquete limpio.

Así la vista previa muestra exactamente lo que va a salir, y lo único que
cambia al exportar son los reemplazos.

La lista es cerrada: lo que no está en «queda» no entra.

**Queda:**

- `word/document.xml`, los estilos, la numeración y el tema;
- `fontTable.xml`, sin las fuentes incrustadas;
- `settings.xml` con una lista blanca de elementos;
- los encabezados y pies **que se usan**, según `headerReference`,
  `titlePg` y `evenAndOddHeaders`;
- las notas al pie y al final que alguna referencia usa;
- las imágenes ráster, **recodificadas desde los píxeles**, sin EXIF, XMP
  ni perfil de color;
- los gráficos, sin su libro incrustado;
- los diagramas (SmartArt);
- `[Content_Types].xml` y las relaciones, rearmados con lo que queda.

**Se va:**

- `docProps/*`, con la miniatura;
- `customXml/*` y los `w:dataBinding` que apuntan ahí;
- los comentarios y `people.xml`;
- el glosario, las macros, los objetos incrustados (OLE) y los controles
  ActiveX. La vista previa de un objeto incrustado queda como imagen;
- `webSettings.xml` y las fuentes incrustadas;
- los encabezados y pies que no se usan, y las notas sin referencia;
- el `mc:Fallback` de cada `mc:AlternateContent`: queda el `mc:Choice`;
- los identificadores de edición: `w:rsid*`, `w14:paraId`, `w14:textId` y
  `w15:docId`;
- de `settings.xml`: `w:rsids`, `w:docVars`, `w:attachedTemplate`,
  `w:mailMerge` y la protección con su hash;
- el texto oculto, también el que se oculta por estilo;
- los destinos externos de los hipervínculos (el texto queda);
- los marcadores;
- el texto alternativo de las imágenes (`descr` y `title`).

**Se resuelve:**

- **los cambios se aceptan**: lo insertado entra, y lo borrado, las filas
  borradas y los cambios de formato salen;
- **los campos se congelan** a su resultado guardado, salvo `PAGE`,
  `NUMPAGES`, `SECTIONPAGES` y `SECTION`, que quedan vivos. Así
  LibreOffice dibuja el mismo valor que va a tener el Word limpio, y un
  dato en un campo (una ruta de `FILENAME`, por ejemplo) se ve y se
  detecta.

Esto reemplaza el preproceso en el XML de la enmienda a ADR-240 §5, que
pasa a ser una parte de este paso. El control por la API de LibreOffice
sigue: si el paquete que recibe el conversor todavía tiene cambios, la
conversión falla cerrada con `details.phase: "preprocess"`.

Con un Word con contraseña (ADR-242), lo que se limpia es el paquete
descifrado, y lo que la app guarda es el paquete limpio.

[Medición pendiente, §8.9: cuánto tarda la limpieza, si LibreOffice abre
siempre el paquete limpio y cuánto baja el texto sin par.]

### 2. El código vive en un paquete puro nuevo

`packages/anonymization-core/ooxml` (`@anonly/ooxml`):

- lee y escribe ZIP con `DecompressionStream` y `CompressionStream`, más un
  CRC32 propio;
- tokeniza el XML y lo edita en el lugar, sin `DOMParser`, que en un Worker
  no existe;
- arma el paquete limpio (§1);
- lee el texto del paquete con el mapa de cada carácter a su origen;
- alinea ese texto con el de las páginas (§3);
- escribe el Word limpio (§5) y lo verifica (§6).

No es un motor: no emite eventos, no recibe `ctx` y no hace E/S, como
`@anonly/shared`. Lo usan el Convert Engine al entrar y el Export Engine al
exportar. No suma dependencias externas (R-12).

### 3. La alineación

El texto de las páginas es el de las palabras del PDF Engine, el mismo que
ven los detectores. Se alinea con el texto del paquete limpio en dos
pasadas, como en el spike:

1. el cuerpo contra todas las páginas, con anclas únicas (patience diff);
2. lo que no es cuerpo (encabezados, pies, notas, cuadros) contra lo que
   quedó sin par, por unidad. Una unidad que aparece en muchas páginas,
   como un encabezado, apunta siempre al mismo lugar del XML.

Lo que no se puede decidir no se elige: queda ambiguo. Una detección
ambigua entre copias idénticas se resuelve con el reemplazo por valor
(§5).

Para que la memoria no crezca con el documento, se alinea por tramos de
páginas. [Medición pendiente, §8.9: tamaño del tramo y exactitud.]

### 4. Las páginas del texto que no se ve

Lo que queda del paquete limpio sin par en las páginas es texto que
LibreOffice no dibuja: un cuadro o una forma, un marco recortado, una celda
girada, el marcador de un control vacío.

- El Convert Engine arma un documento chico con ese texto, un párrafo por
  pedazo y una etiqueta corta de dónde viene («Cuadro de texto», «Forma»,
  «Celda»…), y lo convierte con LibreOffice.
- Sus páginas se suman al final del documento, marcadas con
  `Page.origin: "unseen-text"`. Un `Page` sin `origin` es una página del
  documento, así que todo `Page` de hoy sigue valiendo.
- Los detectores corren sobre esas páginas como sobre cualquier otra.
- Cada pedazo sabe a qué lugar del XML vuelve, y ese mapa viaja con el
  paquete limpio hasta el export.
- **El PDF exportado no lleva esas páginas**: el PDF sale de las páginas
  convertidas, que no tienen ese texto.
- Cómo las distingue el visor va en el ADR de la interfaz de la 1.2.

[Medición pendiente, §8.9: si conviene convertir con el mismo Worker o con
uno nuevo, cuánto suma, y cuántos documentos tienen estas páginas.]

### 5. El Word limpio al exportar

Con `ExportOptions.output: "docx"` (ADR-238 §5), el Export Engine recibe
el paquete limpio, las palabras de las páginas, el mapa de §4 y los
`Replacement` del export.

1. **Cada reemplazo se ubica en el XML**, por sus palabras y la alineación.
   Los de las páginas de §4 se ubican por el mapa.
2. **Si alguno no se ubica, el Word no se exporta** (`Plan_1.2.md` §3). El
   error lleva la lista de los que no se ubicaron, con su página y su caja,
   para que la interfaz los muestre y ofrezca el PDF.
3. **Reemplazo en su lugar**: el texto del reemplazo toma el formato del
   primer run que tapa, y los demás runs del tramo pierden ese texto.
4. **Reemplazo por valor**: además, cada valor original se reemplaza en todo
   el XML que queda, con límites de palabra, incluidos los atributos que
   llevan texto (como el de un WordArt). Cubre las copias idénticas que se
   dibujan menos veces, y lo que la alineación dejó ambiguo.
5. **Imágenes**: una imagen con una tapa se reemplaza por su versión tapada.
   La dibuja el Render Engine, que ya tapa imágenes, por el mismo puerto
   por el que el Export Engine le pide las páginas (ADR-059 §5). El Export
   Engine sigue sin rasterizar nada. [Medición pendiente, §8.9: cómo se
   ubica cada imagen de la página en el paquete, y qué pasa con las
   vectoriales.]
6. **El texto del reemplazo** es el `replacementValue` del grupo, el mismo
   que dibuja el PDF.
   - En modo `redact` («Tapar con negro») ese valor es vacío. En el Word
     va **un bloque del largo del original**: tantos `█` (U+2588) como
     caracteres tiene el valor, espacios incluidos.
   - Lo decidió el mantenedor el 2026-11-24, para que se parezca lo más
     posible a la caja negra del PDF: un bloque de largo fijo queda muy
     corto con un dato largo y muy largo con uno corto.

### 6. La verificación del Word limpio

Al terminar de escribir, el Export Engine **relee el Word limpio** y no lo
entrega si falla algo. Es el equivalente, en cada export, de lo que
ADR-148 verifica en los tests para el PDF:

- **Ningún valor original**: en todas las partes, en todo nodo de texto y en
  todo valor de atributo, se busca cada `originalValue` de los reemplazos,
  normalizado (NFKC, minúsculas, espacios colapsados; en los números,
  también solo los dígitos).
- **Solo la lista cerrada**: ninguna parte fuera de §1, ninguna relación
  externa, ningún `w:rsid*`, `w:ins`, `w:del` ni comentario.

Si falla, el export falla cerrado y no se escribe ningún archivo. Además,
la suite de seguridad corre la misma verificación sobre los sintéticos,
como ADR-148 con el PDF.

[Medición pendiente, §8.9: falsos positivos de la verificación, y si
LibreOffice abre el Word limpio con el mismo texto salvo los reemplazos.]

### 7. Trabajos, plazos y errores

- **Al entrar**: la limpieza va dentro del trabajo `convert-office`
  (ADR-240 §2). La alineación y el documento chico de §4 son un trabajo
  nuevo del Convert Engine, después de que el PDF Engine lee las páginas.
  [Nombre, plazo y si carga LibreOffice de nuevo: según §8.9.]
- **Al exportar**: el Word limpio es un camino nuevo del Export Engine para
  `output: "docx"`, en su mismo Worker.
- **Errores nuevos** del Export Engine:
  - `EXPORT_DOCX_UNLOCATED`: hay reemplazos que no se ubican en el XML;
    `details: { replacements: { pageIndex, bbox }[] }`.
  - `EXPORT_DOCX_VERIFY_FAILED`: la verificación de §6 encontró algo;
    `details: { check: "value" | "part" | "structure" }`, sin el valor.
- Al entrar, una falla de la limpieza es `OFFICE_CONVERT_FAILED` con
  `details.phase: "clean"`, que se suma a las fases de ADR-240 §8.

[Verificar antes de publicar: que los códigos nuevos no choquen con
`Contracts.md` ni con `shared/src/enums.ts`.]

### 8. Lo que este ADR no decide

- Cómo muestra la interfaz las páginas de §4 y qué dice el diálogo de
  exportar cuando el Word no se puede exportar: va en el ADR de la
  interfaz.
- El Word como salida de un Excel o un PowerPoint: no existe (`Plan_1.2.md`
  §11).

## Consecuencias

Cambian, después de que el mantenedor acepte:

- `Contracts.md` y `03_Data_Model.md`: `Page.origin`, los dos errores
  nuevos y la fase `"clean"`.
- `Convert_Engine.md`: la limpieza, la alineación y el documento chico;
  `@anonly/ooxml` en sus dependencias permitidas.
- `Export_Engine.md`: el camino de `output: "docx"` y su verificación;
  `@anonly/ooxml` en sus dependencias permitidas.
- `Render_Engine.md`: tapar una imagen del Word por el puerto del export.
- `Orchestrator.md`: guarda el paquete limpio en lugar del original, el
  trabajo nuevo al entrar y las páginas de §4 fuera del PDF.
- Un spec nuevo, `core/OOXML.md`, para el paquete puro.
- `08_Security_Model.md` y ADR-009: qué garantiza un Word limpio.
- ADR-240 §5 y ADR-242: las enmiendas de §1.
- `CLAUDE.md` y `ai/Code_Standards.md` §12, si nombran los paquetes que un
  motor puede importar.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| **Guardar el original y limpiar al exportar** | La vista previa y el Word limpio salen de textos distintos, y el original queda en la memoria toda la sesión (Contexto §3). |
| **Frenar el Word si hay texto sin par** | Medido en §8.8: frenaba entre el 8,6 y el 22,4 % de los Word de prueba. El mantenedor eligió mostrarlo (§3). |
| **Borrar el texto sin par y avisar** | Se pierde contenido que el usuario ve en Word. El mantenedor eligió mostrarlo (§3). |
| **Dibujar las páginas de §4 con `pdf-lib`** | Con sus fuentes de serie solo hay WinAnsi; para incrustar una fuente hace falta `@pdf-lib/fontkit`, una dependencia nueva. LibreOffice ya tiene las fuentes. |
| **Un lector de XML de terceros** (`sax`, `@xmldom/xmldom`) | Es una dependencia nueva para algo que el spike resolvió con unas 100 líneas. |
| **Reemplazar solo en el lugar, sin buscar por valor** | Deja en claro las copias idénticas que se dibujan menos veces, y lo que la alineación deja ambiguo (§8.8). |
