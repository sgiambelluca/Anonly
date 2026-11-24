# Spike: preproceso dentro del conversor y Office con contraseña

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\PREPROCESO_Y_CIFRADO.md` el 2026-11-24.
> El corpus y el código quedan fuera del repo, en `C:\Anonly\spikes\lowa\`.
> Qué decide el planificador con esto: `Plan_1.2.md` §8.7, ADR-240 y
> ADR-242.

Fecha: 2026-11-24. Conversor medido: LibreOffice 26.8.3.1 propio, `dynexec0` con el recorte `rec-C`, en un Worker bajo `app://` con la CSP estricta, Electron 44.11.5 del repo. Node 22.23.2. `pdfjs-dist` 4.10.38 y `pdf-lib` 1.17.1 del `node_modules` del repo (solo lectura). No se tocó `C:\Anonly\Anonly` ni se commiteó nada.

**Datos:** todos los documentos propios son sintéticos e inventados (cadenas `PRE-...`). No hay `ANONLY_REAL_DOC_*` definidas, así que no se midió con ningún documento real. Los documentos del árbol de LibreOffice son archivos de prueba públicos de ese proyecto. No se descargó nada. Las únicas contraseñas son las de los tests de LibreOffice (`abc`) y las de mis archivos sintéticos.

## Hallazgo que contradice el ADR-240

**El conversor adoptado SÍ abre Office cifrado, sin descifrar en JS.** `config_host.mk` del árbol dice `ENABLE_NSS=` vacío, pero también `ENABLE_OPENSSL=TRUE`, `TLS=OPENSSL` y `config_oox.h` trae `USE_TLS_OPENSSL 1`: el build lleva OpenSSL propio. `loadComponentFromURL` con la propiedad `Password` abrió los 4 `.docx` cifrados (Standard y Agile) y el texto del PDF coincide con lo que esperan los tests de LibreOffice (`abc` y `ABC`). El INFORME del spike anterior lo daba por "casi seguro no abre" sin probarlo. ADR-240 §1 («Sin NSS: el conversor no descifra») y §9 parten de esa suposición. El descifrado propio en JS (B2) también anda y se midió, pero hay que decidir entre las dos vías (ver B).

## Veredictos

| Punto | Veredicto |
|---|---|
| A1 Aceptar cambios | **Anda con el despachador, no con la API.** `.uno:AcceptAllTrackedChanges` funciona en el build sin interfaz. Es **asíncrono**: hay que ceder el control al bucle de eventos y esperar. Con dos precauciones obligatorias (RecordChanges y protección). |
| A2 Borrar comentarios | **Anda por la API** en docx, xlsx y pptx clásico, con una excepción: hoja de Excel protegida con contraseña (hay alternativa). Los comentarios modernos de pptx no se importan. |
| A3 Exportar con `FilterData` y verificar | **Cumple** en 20 de 20 archivos propios y 188 de 189 del árbol (el que falla es la hoja protegida, resuelta con la alternativa). |
| A4 Limpieza del PDF | **Cumple.** Texto e imagen idénticos, nada de lo pedido queda. 1 a 2 ms en un PDF chico, 1,2 s con 500 páginas, 4,9 s con 2000. |
| B1 Corpus | Solo hay **4** documentos cifrados en todo el árbol, todos `.docx`: 2 Standard y 2 Agile. Ninguno `.xlsx` ni `.pptx`. |
| B2 Descifrador propio | **Anda** con los 4 archivos reales, en Node y en un Worker de Electron. |
| B3 Mediciones | Hechas, ver tablas. Un archivo `.xlsx` o `.pptx` cifrado real **[NO CONFIRMADO]**. |

## A. Preproceso

### A1. Aceptar el control de cambios en un `.docx`

- Con `Hidden`, el documento **sí tiene controlador y frame** (`getCurrentController().getFrame()`), así que se puede despachar.
- **API (`XRedlinesSupplier`)**: solo permite *leer*. Las redlines son un `XPropertySet` con `RedlineType`, `RedlineAuthor`, `RedlineStart/End`, etc. y **no hay método para aceptar o rechazar**. No sirve para aceptar.
- **Despachador**: `queryDispatch(frame, ".uno:AcceptAllTrackedChanges")` y `css.frame.DispatchHelper.executeDispatch` funcionan igual.
  - **Es asíncrono**: justo después de `dispatch` el conteo de redlines sigue igual. Hay que ceder (`await setTimeout`) y consultar con `getRedlines().hasElements()` hasta que sea falso.
  - **No enumerar redlines para esperar**: enumerarlas por zetajs cuesta ~2 ms cada una y frena todo. Con `hasElements()`, 6000 redlines (3000 pares borrado/inserción) se aceptan en **0,93 s** y 1000 redlines en ~0,2 s. Documentos chicos: 20 a 100 ms.
- **Trampa 1, control de cambios protegido** (`w:documentProtection w:edit="trackedChanges"`, 2 archivos del árbol): el despachador **no hace nada y deja trabada la instancia**: todos los documentos siguientes de la misma sesión tampoco aceptaban (15 archivos seguidos fallaron hasta el final del lote). Solución medida: poner `RedlineProtectionKey` en una secuencia vacía antes de despachar. Con eso aceptó y no trabó nada. El Convert Engine termina el pool al terminar, así que la instancia trabada no contaminaría a otro documento, pero el documento propio saldría con lo borrado a la vista: **hay que fallar cerrado** (no exportar si `hasElements()` sigue verdadero tras el plazo).
- **Trampa 2, `RecordChanges` activo**: si el documento viene con el registro de cambios encendido, **borrar un comentario queda registrado como un cambio** y el comentario sigue ahí (6 comentarios antes y después, más 2 redlines nuevas). Solución medida: `setPropertyValue("RecordChanges", false)` antes de todo.
- **Orden que funcionó**: `RecordChanges=false`, vaciar `RedlineProtectionKey`, aceptar y esperar, borrar comentarios, exportar.

Resultados:

| Corpus | Casos | Resultado |
|---|---|---|
| Sintético `w-cambios.docx` (16 redlines: borrado/insertado en cuerpo, párrafo entero, formato, mover, filas de tabla, encabezado, nota al pie) | 1 | Quedan los 9 textos insertados y base; desaparecen los 6 borrados; el texto movido sale **una** vez. |
| Árbol de LibreOffice con cambios | 113 `.docx` | **113 de 113 llegan a 0 redlines** con las dos precauciones. Con el oráculo heurístico sobre el XML: 1 borrado que sobrevive (ver abajo) y 2 falsos positivos del oráculo, revisados a mano. |

- **Caso real que falla:** `n830205.docx` (`w058`, `sw/qa/extras/ooxmlexport/data`): un párrafo con la marca de párrafo borrada y el texto `XXX` borrado. Tras aceptar, **LibreOffice deja el `XXX`** en el PDF. Es un límite de LibreOffice, no del mecanismo. Preproceso por XML lo resolvería para ese caso. **[NO CONFIRMADO]** si Word lo hace distinto: no hay Word aquí.

### A2. Borrar comentarios

| Formato | Método que anda | Detalle |
|---|---|---|
| `.docx` | `getTextFields()`, filtrar `TextField.Annotation`, `dispose()` | Borra raíz y respuestas (5 de 5), incluso comentarios sobre texto borrado/insertado y dentro de tabla. Sin `RecordChanges=false` queda registrado como cambio. |
| `.xlsx` notas | `sheet.getAnnotations().removeByIndex(0)` en bucle | 3 de 3, incluida una nota visible. |
| `.xlsx` hilo (threaded) | igual | LibreOffice importa el hilo como **una** nota con la raíz y la respuesta juntas; se borra y desaparece. |
| `.pptx` clásico | `page.createAnnotationEnumeration()` y `page.removeAnnotation` | 3 de 3 (2 diapositivas). |
| `.pptx` moderno (`p188`, `ppt/comments/modernComment_*`) | no hace falta | **LibreOffice 26.8 no los importa** (0 comentarios). No llegan al PDF aunque se pida `ExportNotes`. |
| `.xlsx` con **hoja protegida con contraseña** (`tdf119190.xlsx`) | **no se pueden borrar**: `removeByIndex`, `clearContents(4)` y `DeleteAllNotes` no hacen nada; `unprotect("")` falla; despachar `DeleteAllNotes` además provocó un `RuntimeError: unreachable` en el Worker | Alternativa medida que **sí anda** sobre la hoja protegida: `annotation.setString("")` + `setIsVisible(false)` + `PrintAnnotations=false` en los estilos de página. El texto de la nota desaparece del PDF. La nota queda como objeto vacío (con `ExportNotes=false` ni eso sale). **Aviso:** el bucle de borrado necesita un tope (en esta hoja un `while (count > 0)` no termina; se colgó 120 s). |

### A3. Exportar con `FilterData` y verificar con pdfjs

Se comparó, para los 10 documentos sintéticos, tres configuraciones: `def` (FilterData por defecto, sin preproceso), `base` (FilterData de ADR-240 §3, sin preproceso) y `pre` (preproceso completo + FilterData). Texto, anotaciones, `Info` y XMP se miraron con pdfjs.

- **`pre`: 10 de 10 correctos.** Lo borrado no está, lo insertado sí, ningún comentario ni como texto ni como anotación (la única anotación que queda en `w-cambios` son 2 `Link` de la nota al pie, que A4 elimina).
- **`base` sin preproceso:** los 6 textos borrados de `w-cambios`, el borrado de `w-ambos` y la **nota visible de Excel** (`PRE-NOTA-02`) **salen en el PDF**. Es decir, `FilterData` por sí solo no alcanza: las notas visibles de Calc y las redlines se dibujan como contenido.
- **Control positivo:** con `ExportNotes=true` y sin borrar, los comentarios aparecen como anotaciones `Text`/`Popup` con el texto y el autor (docx 10, xlsx 6, pptx 6, hilo 2). Con `ExportNotes=true` y con el borrado, **0**. Así se prueba que el borrado funciona y que no es solo que no se vean.
- **Hallazgo de `FilterData`:** `ExportNotesInMargin=true` hace **fallar la exportación** (`IOException ... Error Code:16`) en cualquier `.docx` con comentarios, en este build. Con el borrado previo anda. ADR-240 lo pone en `false`; queda bien así.
- Corpus del árbol (189 archivos con cambios o comentarios, exportando con `ExportNotes=true` como prueba fuerte): 189 sin error de carga ni de exportación, 0 timeouts; 0 redlines tras aceptar en los 113 con cambios; 52 de 53 con comentarios quedan en 0 (el 53.º es la hoja protegida, resuelta con la alternativa de A2); 0 anotaciones de comentario en los PDF salvo ese archivo.

### A4. Limpieza del PDF intermedio (pdf-lib, Node)

Se quitan `Info`, `Metadata` (XMP), `Annots` de cada página y del catálogo `Outlines`, `Names`, `AcroForm`, `StructTreeRoot`, `MarkInfo`, `OpenAction`. Además se quita `StructParents` de la página y **se borran los objetos huérfanos**.

- **Trampa de pdf-lib:** quitar la referencia del catálogo no basta. `PDFDocument.save()` escribe todos los objetos del contexto. Hay que borrar los objetos que quedaron sin referencia (Info, XMP, outlines, anotaciones) o su contenido sigue dentro del archivo. Con el barrido de huérfanos, ni el título, ni el autor, ni la URL de un enlace, ni «LibreOffice» aparecen en ningún byte del PDF limpio.
- Lo que LibreOffice 26.8 pone y se va: `Info`, `Metadata`, `Outlines` (Calc e Impress), `Annots` (enlaces). Quedan `ViewerPreferences` y `Lang` en el catálogo: no estaban en la lista y no llevan datos del documento.
- Páginas que quedan con `Contents`, `MediaBox`, `Parent`, `Resources`, `Tabs`, `Type`.

| PDF | Páginas | Anotaciones antes → después | Texto idéntico | Imagen idéntica | Tiempo mediana (carga + edición + barrido + guardado) | Bytes antes → después |
|---|---|---|---|---|---|---|
| `w-cambios` | 1 | 2 → 0 | sí | sí | 2 ms | 30 171 → 23 959 |
| `x-notas` | 2 | 0 → 0 | sí | sí | 2 ms | 13 355 → 7 134 |
| `p-comentarios` | 2 | 0 → 0 | sí | sí | 1 ms | 14 323 → 7 783 |
| `g-paginas-10` | 10 | 10 → 0 | sí | sí | 16 ms | 23 122 → 15 365 |
| `g-paginas-500` | 500 | 500 → 0 | sí | sí | **1245 ms** (carga 290, guardado 956) | 381 702 → 281 385 |
| `g-paginas-2000` | 2000 | 2000 → 0 | sí | sí | **4929 ms** (carga 1145, guardado 3781) | 1 497 846 → 1 113 272 |

Imagen: `pdftoppm` a 36 dpi (72 dpi en los chicos), hash por página. Cajas de página idénticas, mismo número de páginas. Tiempos de 5 repeticiones en Node, sin objetos comprimidos en el guardado; el costo está en guardar. **[NO CONFIRMADO]** el tiempo dentro de un Worker de Electron.

Tiempos del preproceso completo dentro del conversor, ya con el despachador y todo (sintéticos grandes): `g-paginas-500` 0,67 s en total; `g-paginas-2000` 4,4 s (de los cuales 2,8 s son la exportación a PDF); `g-cambios-3000` (6000 redlines) 1,9 s.

## B. Office con contraseña

### B1. Corpus (leído por `EncryptionInfo`)

Búsqueda sobre **todo** el árbol (cualquier archivo con cabecera OLE y `EncryptedPackage`): 4 archivos, todos en `sw/qa/extras/ooxmlexport/data/`, contraseña `abc` en `ooxmlencryption.cxx`. Los tests de `sc` y `sd` cifran en el momento (ida y vuelta), no hay archivos.

| Archivo | Versión | Tipo | Cifrado (según el test y `EncryptionInfo`) | Bytes |
|---|---|---|---|---|
| `Encrypted_MSO2007_abc.docx` | 3.2, flags 0x24 | **Standard** | AES-128, SHA-1, ECB | 18 432 |
| `Encrypted_LO_Standard_abc.docx` | 3.2, flags 0x24 | **Standard** | AES-128, SHA-1, ECB (hecho por LibreOffice) | 7 680 |
| `Encrypted_MSO2010_abc.docx` | 4.4, flags 0x40 | **Agile** | AES-128, CBC, SHA-1, spin 100 000 | 19 456 |
| `Encrypted_MSO2013_abc.docx` | 4.4, flags 0x40 | **Agile** | AES-256, CBC, SHA-512, spin 100 000 | 17 920 |

**Pocos:** 2 de cada tipo, solo Word. **Cero** `.xlsx` o `.pptx` cifrados, y ninguno de tipo Extensible, RC4 o IRM. Se copiaron a `corpus-cifrado\lo-docx\`. Para los tamaños grandes se armaron archivos **sintéticos de ida y vuelta** con un cifrador de prueba propio (`gen-grande.mjs`, usa `node:crypto` solo para AES y SHA, y un escritor de OLE propio de 4096 B): 10, 100 y 250 MB, Agile AES-256 SHA-512 y Standard AES-128. Prueban tiempo, memoria y el recorrido por segmentos o trozos; **no** prueban que el estándar esté bien seguido (eso lo prueban los 4 archivos reales).

### B2. Descifrador propio (`harness\descifrado\`)

Archivos: `cfb.mjs` (lector OLE/CFB, tope 4096 entradas y escritor mínimo), `ooxml-crypto.mjs` (EncryptionInfo, derivación, verificador, `EncryptedPackage`, HMAC de integridad Agile, reconocimiento por `[Content_Types].xml` según ADR-238 §2.1), `hash-js.mjs` (SHA-1 y SHA-512 propios con el bucle de derivación sin asignaciones), `aes-js.mjs` (AES propio, descifrado ECB), `bench-core.mjs`, `probar.mjs`. Sin dependencias.

- **Verificación:** SHA-1, SHA-512, el bucle de derivación y AES-128/192/256 propios dan el mismo resultado que `node:crypto`.
- **Los 4 archivos reales se descifran** con la contraseña de los tests. El ZIP descifrado pasa el CRC, se reconoce como `docx` por `[Content_Types].xml` y su texto es `abc`, `abc`, `abc`, `ABC` / `ABC` según el test. En los 2 Agile **verificó el HMAC de integridad** (`dataIntegrity`).
- **Trucos necesarios (WebCrypto no tiene AES sin relleno ni ECB):**
  - *CBC sin relleno:* se agrega un bloque cifrado que descifra a relleno válido (una llamada extra `encrypt` con IV = último bloque cifrado) y se descarta.
  - *Agile por segmentos de 4096 B:* los IV son distintos por segmento. Se descifra un trozo grande en **una sola llamada** CBC con IV cero y se corrige el primer bloque de cada segmento (`P = P' xor bloque cifrado anterior xor IV_i`). Da el mismo resultado que una llamada por segmento.
  - *ECB:* `ECB(C_j) = CBC-con-IV-cero(C_j) xor C_{j-1}`. Una llamada por trozo.
- **Standard, los dos métodos pedidos:** ambos dan salida idéntica. ECB emulado sobre CBC de WebCrypto: 405 a 535 MB/s. AES propio: 130 a 160 MB/s y **menos memoria**. Una llamada WebCrypto por bloque de 16 B (naive): 0,3 MB/s en Node y 2 MB/s en Electron, **inservible**. Se elige: **ECB emulado** si importa el tiempo, **AES propio** si importa la memoria (ver B3); ambos son aceptables (250 MB en 0,6 s y 1,7 s).

### B3. Mediciones

**Derivación de clave, 100 000 iteraciones SHA-512 en serie (mediana de 5):**

| Entorno | `crypto.subtle.digest` en serie | SHA-512 propio en JS | `node:crypto` síncrono (referencia) |
|---|---|---|---|
| Node 22 | 2058 ms | 161 ms | 141 ms |
| **Worker de Electron 44** | **365 ms** | **159 ms** | n/a |

SHA-1: 100 000 iteraciones = 1976 ms (Node) y 327 ms (Worker) con WebCrypto, contra 26 y 21 ms con el SHA-1 propio; 50 000 (Standard) = 997 ms / 156 ms contra 13 / 10 ms. En el Worker de la app ambas vías son menos de medio segundo; el SHA propio gana por ~2,3x en SHA-512 y ~15x en SHA-1. Mucho más lento en Node por el costo por llamada.

**Descifrado de datos (32 MB aleatorios, mediana):**

| Método | Node MB/s | Worker Electron MB/s |
|---|---|---|
| Agile, un CBC por trozo + corrección, IV con SHA propio (trozo 4 MB) | 535 | 385 |
| Agile, igual, trozo 16 MB | 659 | 481 |
| Agile, IV con `subtle.digest` en paralelo | 337 | 459 |
| Agile, IV con `subtle.digest` en serie | 170 | 453 |
| Agile, 2 llamadas WebCrypto por segmento de 4096 B | 68 | 190 |
| Standard, ECB emulado en CBC (4 MB / 16 MB) | 536 / 560 | 406 / 491 |
| Standard, AES propio | 160 | 132 |
| Standard, una llamada por bloque | 0,3 | 2,1 |

**Contraseña equivocada:** se detecta **siempre con el verificador, antes de tocar `EncryptedPackage`**. 10 contraseñas «tipo» (`abd`, `ABC`, `abc `, ` abc`, vacía, `ab`, `abcd`, `Abc`, `abc\0`, `contraseña`) y 200 al azar por archivo × 4 archivos: **0 aperturas indebidas**, todas con el código `PASSWORD_INCORRECTA`. Tiempo hasta detectarla = el de la derivación: 16 ms (Standard), 33 ms (Agile SHA-1), 164 ms (Agile SHA-512), en Node con SHA propio. En el Worker de Electron: 10, 10, 20 y 157 ms.

**Conversión:** los 4 paquetes descifrados por el descifrador JS se reconocen como `docx` y el conversor adoptado los convierte a PDF con el texto esperado (`abc`/`ABC`). **No existe versión sin cifrar** de esos documentos, así que el «mismo resultado» se comparó contra el texto esperado de los tests. Un `.xlsx` o `.pptx` cifrado real **[NO CONFIRMADO]**: no hay en el árbol.

**Memoria del descifrado JS en un Worker de Electron** (`Tab`, bytes privados; delta sobre la base, que ya incluye el archivo recibido):

| Archivo | Método | Tiempo | Memoria extra |
|---|---|---|---|
| 100 MB Agile AES-256 SHA-512 | copia, trozo 4 MB | 395 ms | +259 MB (2,6x) |
| 100 MB Agile | **en el lugar**, trozo 1 MB | 438 ms | **+133 MB (1,3x)** |
| 250 MB Agile | copia, trozo 4 MB | 768 ms | +600 MB (2,4x) |
| 250 MB Agile | **en el lugar**, trozo 1 MB | 794 ms | **+315 MB (1,3x)** |
| 100 MB Standard | ECB emulado, en el lugar, trozo 1 MB | 262 ms | +252 MB |
| 250 MB Standard | ECB emulado, en el lugar, trozo 1 MB | 653 ms | +563 MB (2,3x) |
| 100 MB Standard | AES propio, en el lugar | 669 ms | **+107 MB (1,0x)** |
| 250 MB Standard | AES propio, en el lugar | 1647 ms | **+258 MB (1,0x)** |

Todos los hashes SHA-256 de la salida coinciden con el del paquete que generó el cifrador de prueba. El «+1x» es la copia del stream que saca el lector OLE; hay que sumarle el archivo de entrada y el paquete resultante.

### B4. La alternativa que apareció: dejar que LibreOffice descifre

Probado con el mismo conversor, `Password` en `loadComponentFromURL`, sobre los 4 archivos reales:

| Modo | Resultado |
|---|---|
| Con contraseña correcta | Abre los 4 (Standard y Agile). 112 a 342 ms de carga, el texto es el esperado. |
| Sin contraseña / contraseña equivocada, sin manejador | `loadComponentFromURL` **lanza** `IllegalArgumentException: Unsupported URL … type detection aborted`. **No se distingue «contraseña mala» de «archivo no soportado»**. |
| Con `XInteractionHandler` (zetajs `unoObject`) | LibreOffice pide `DocumentMSPasswordRequest2` y **vuelve a pedirla tras cada contraseña mala** (5 pedidos antes de que el manejador aborte). Con una mala y luego la buena abre. Así sí se distingue: que haya un segundo pedido tras dar una clave = contraseña equivocada. El modo del pedido (`Mode`) no se pudo imprimir como número (objeto). |

Archivos grandes abiertos de forma nativa (Worker de LibreOffice; `Tab`, mediciones de la app completa con el conversor cargado):

| Archivo | Carga + descifrado nativo | Memoria base → pico (privados del renderer) |
|---|---|---|
| 10 MB Agile / Standard | 655 / 490 ms | 1500 → 1853 / 1502 → 1821 MB |
| 100 MB Agile / Standard | 2422 / 1940 ms | 1684 → 2233 / 1678 → 2235 MB |
| 250 MB Agile / Standard | 5454 / 4318 ms | 1979 → 2913 / 1983 → 2917 MB |

(Incluye cargar y exportar un documento válido; el relleno del paquete no se convierte en contenido.) Pico +0,9 GB con 250 MB, por encima de lo que cuesta el descifrado JS aparte (+0,3 GB).

**Comparación:** nativo = cero código nuevo y cubre los cifrados que cubra OpenSSL de LibreOffice, pero la señal de contraseña mala depende del manejador, y descifra dentro de la memoria del conversor. JS = señal limpia de contraseña mala **antes** de cargar LibreOffice (16 a 160 ms), error propio y tipado antes de pagar los 2,9 s de arranque del conversor, y permite reconocer el formato (`docx`/`xlsx`/`pptx`) antes de convertir; cuesta código nuevo. **[NO CONFIRMADO]** la decisión: es del planificador y del mantenedor.

## Recomendación por punto

| Punto | Método |
|---|---|
| A1 | `.uno:AcceptAllTrackedChanges` por `getCurrentController().getFrame()`, después de `RecordChanges=false` y de vaciar `RedlineProtectionKey`. Esperar con `getRedlines().hasElements()` cediendo al bucle (no enumerar). Plazo propio; si vence, fallar cerrado y no exportar. |
| A2 | docx `dispose()` de los campos `Annotation`; xlsx `removeByIndex` con tope y alternativa (`setString("")` + `setIsVisible(false)` + `PrintAnnotations=false`) para hojas protegidas; pptx `removeAnnotation`. |
| A3 | `FilterData` de ADR-240 §3 tal cual. Por sí solo no saca las notas visibles de Calc ni las redlines: el preproceso es obligatorio. |
| A4 | pdf-lib con barrido de objetos huérfanos. Costo lineal en páginas, dominado por el guardado. |
| B2 | Si el planificador quiere el descifrado propio: Agile con CBC por trozo + corrección, en el lugar; derivación con SHA propio (SHA-512 y SHA-1) o `subtle.digest` (también anda en el Worker, 2,3x a 15x más lento); Standard con ECB emulado o AES propio. |
| B3 | Ver B4: la vía nativa existe y anda sin nada nuevo. |

## Lo que quedó sin medir o sin confirmar

- **[NO CONFIRMADO]** Office cifrado de tipo `.xlsx` o `.pptx` real (solo hay 4 `.docx`).
- **[NO CONFIRMADO]** Cifrados Extensible, RC4 (Word 97-2003 en OOXML), IRM y Agile con SHA-256/384: el código los reconoce y rechaza o delega, no hay archivo para probarlos.
- **[NO CONFIRMADO]** Tiempo de la limpieza del PDF dentro de un Worker de Electron (se midió en Node 22).
- **[NO CONFIRMADO]** Si Word acepta el caso `n830205.docx` de otra forma que LibreOffice.
- El preproceso del árbol de LibreOffice se corrió con enumeración de redlines para esperar (más lenta); los números de tiempo útiles son los de los sintéticos grandes con `hasElements()`.
- Sin documentos reales en ninguna medición.
- No se usó `eval` en el hilo de LibreOffice: las operaciones se cargan con `import()` dinámico. La prueba corre bajo CSP estricta en la página, pero un Worker cargado desde `app://` no hereda esa CSP (hallazgo del spike anterior).

## Dónde está todo

- Código: `harness\preproceso\` (Electron, `page\ops\pre.js`, `cifrado.js`, `protegida.js`, generadores, verificadores, `limpieza-tiempos.mjs`) y `harness\descifrado\` (descifrador, banco Node y `electron\`).
- Corpus: `corpus-preproceso\{sintetico,lo-tree,grandes}`, `corpus-cifrado\{lo-docx,grandes}` (738 MB sintéticos).
- Datos: `results\preproceso-cifrado\a\` (preproceso), `b\` (cifrado, `bench-node.json`, `bench-electron.json`, `mem*.json`, `lo-nativo*`), `arbol-escaneo.json`.
