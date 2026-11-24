<!-- CONTEXT: scope=paquete-ooxml | dependencias=core/Contracts.md,core/Convert_Engine.md,core/Export_Engine.md,adr/ADR-243-El-Word-Se-Limpia-Al-Entrar-Y-El-Word-Limpio-Sale-De-Ese-Paquete.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,roadmap/formatos/Word_Limpio_Escritura_2026-11-24.md,roadmap/formatos/Word_Limpio_Alineacion_2026-11-24.md | audiencia=IA-implementador | fase=1.2 -->

# OOXML — Spec del paquete puro

> Limpia un Word al entrar, lee su texto, lo alinea con el de las páginas y,
> al exportar, escribe y verifica el Word limpio (ADR-243). No es un motor:
> no emite eventos, no recibe `ctx` y no hace E/S. Lo usan el Convert Engine
> al entrar y el Export Engine al exportar.

**Paquete**: `@anonly/ooxml`
**Ubicación**: `packages/anonymization-core/ooxml/`
**`EngineId`**: ninguno. Es un paquete puro, como `@anonly/shared`
(ADR-243 §2).

---

## 1. Objetivo

Que el Word que la app muestra y el Word limpio que exporta salgan del mismo
paquete, armado con una lista cerrada de partes, y que nada que no esté en
esa lista llegue al archivo exportado. El paquete hace las cinco cosas que
necesita eso:

1. armar el paquete limpio desde el `.docx` que entra (§6.2);
2. alinear el texto de ese paquete con el de las páginas que dibujó
   LibreOffice (§6.3), y ubicar sus imágenes (§6.4);
3. guardar esa alineación en bytes, para que viaje hasta el export (§6.5);
4. al exportar, ubicar cada reemplazo en el XML y escribir el Word limpio
   (§6.6 y §6.7);
5. verificar el Word limpio antes de entregarlo (§6.8).

---

## 2. Responsabilidades

- Leer y escribir ZIP con `DecompressionStream` y `CompressionStream`
  (`deflate-raw`), más un CRC32 propio.
- Tokenizar el XML y editarlo en el lugar, sin `DOMParser`, que en un Worker
  no existe.
- Aplicar la lista cerrada de ADR-243 §1: lo que queda, lo que se va y lo que
  se resuelve (cambios aceptados, campos congelados).
- Leer el texto del paquete con el mapa de cada carácter a su lugar del XML.
- Alinear en dos pasadas, el cuerpo con patience diff y lo demás por unidad,
  y devolver los pedazos que ninguna página dibuja.
- Armar el `.docx` chico de las páginas del texto que no se ve (ADR-243 §4).
- Comparar las miniaturas de las imágenes que dibujan las páginas con las de
  `word/media`.
- Ubicar los reemplazos, escribir el Word limpio (en su lugar y por valor) y
  verificarlo, todo en tiempo lineal (ADR-243 §5, paso 7).

---

## 3. Fuera de alcance

- **Decodificar o codificar píxeles.** Lo hace quien lo usa:
  - el Convert Engine recodifica las imágenes al limpiar y arma las
    miniaturas de `word/media`, con `createImageBitmap` y `OffscreenCanvas`;
  - el Render Engine tapa una imagen al exportar (ADR-243 §9, punto 4).

  Este paquete recibe un recodificador inyectado (§6.2) y bytes ya
  codificados.
- **Convertir con LibreOffice** o leer un PDF. Las palabras y las imágenes
  de cada página le llegan como datos (`Word`, `DrawnImage`).
- **Descifrar** un Office: lo hace el Convert Engine (ADR-242).
- **Excel y PowerPoint**: no tienen salida en su formato (`Plan_1.2.md` §11).
  Este paquete trabaja solo con `.docx`.
- **Detectar** datos: recibe los `Replacement` ya armados.
- Emitir eventos, recibir `ctx`, loguear, medir el tiempo o cancelar. El
  motor que lo llama controla el plazo y la cancelación.

---

## 4. Dependencias permitidas

- `@anonly/shared`: solo tipos (`Word`, `Page`, `Replacement`,
  `BoundingBox`, `DrawnImage`, `ReplacementMode`).
- Las APIs estándar que existen en un Worker y en Node 22:
  `DecompressionStream`, `CompressionStream`, `TextEncoder`, `TextDecoder`.

Ninguna dependencia externa (R-12, ADR-243 §2).

---

## 5. Dependencias prohibidas

- Cualquier motor (`@anonly/*-engine`), `@anonly/event-system` y el façade.
- `react`, `react-dom`, `apps/react-client`.
- `DOMParser`, `XMLSerializer`, `document`, `window`, `OffscreenCanvas` y
  `createImageBitmap`.
- `pdfjs-dist`, `pdf-lib`, `utif2` y cualquier paquete npm de ZIP, XML u
  Office.
- Node builtins, red y `console.*` (P-4, P-6, P-7).

---

## 6. Interfaces públicas

```ts
// §6.1
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}
export function readZip(bytes: ArrayBuffer): Promise<ReadonlyArray<ZipEntry>>;
export function writeZip(entries: ReadonlyArray<ZipEntry>): Promise<ArrayBuffer>;

// §6.2
export interface ImageRecoder {
  // Recodifica desde los píxeles, sin EXIF, XMP ni perfil de color. crop, si
  // está, es el a:srcRect en fracciones (0..1) de cada borde, y se aplica de
  // verdad. Un GIF devuelve PNG con el primer cuadro; un TIFF, PNG.
  recode(input: {
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly crop?: { readonly l: number; readonly t: number; readonly r: number; readonly b: number };
  }): Promise<{ readonly bytes: Uint8Array; readonly mime: "image/png" | "image/jpeg" }>;
}
export interface CleanDocxResult {
  readonly package: ArrayBuffer;   // el paquete limpio
  readonly textLength: number;     // caracteres del texto que lee §6.3
}
export function cleanDocx(original: ArrayBuffer, recoder: ImageRecoder): Promise<CleanDocxResult>;

// §6.3
export type UnseenLabel =
  | "Cuadro de texto" | "Celda" | "Encabezado" | "Pie"
  | "Nota al pie" | "Nota al final" | "Texto que no se dibujó";
export interface UnseenPiece {
  readonly label: UnseenLabel;
  readonly text: string;
}
export interface DocxAlignResult {
  readonly alignment: DocxAlignment;          // opaco; se guarda con §6.5
  readonly unseenPieces: ReadonlyArray<UnseenPiece>; // en orden del XML
}
export function alignDocx(
  cleanPackage: ArrayBuffer,
  pages: ReadonlyArray<ReadonlyArray<Word>>,
): Promise<DocxAlignResult>;
export function buildUnseenDocx(pieces: ReadonlyArray<UnseenPiece>): Promise<ArrayBuffer>;

// §6.4
export interface MediaPart {
  readonly partName: string;       // p. ej. "word/media/image3.png"
  readonly mime: string;
  readonly bytes: Uint8Array;
}
export function listMediaParts(cleanPackage: ArrayBuffer): Promise<ReadonlyArray<MediaPart>>;
export function matchImages(
  alignment: DocxAlignment,
  drawn: ReadonlyArray<DrawnImage>,
  media: ReadonlyArray<{ readonly partName: string; readonly thumbnail: Uint8Array }>, // 16 × 16 RGBA
): DocxAlignment;                  // la misma alineación, con las imágenes ubicadas

// §6.5
export interface DocxAlignment { readonly __brand: "DocxAlignment" } // opaco fuera del paquete
export function encodeAlignment(alignment: DocxAlignment): ArrayBuffer;
export function decodeAlignment(bytes: ArrayBuffer): DocxAlignment;

// §6.6
export interface ImageCoverRequest {
  readonly partName: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  // Las tapas en píxeles de la parte, ya con la transformación inversa.
  readonly covers: ReadonlyArray<{
    readonly bbox: BoundingBox;
    readonly replacementValue: string;
    readonly mode: ReplacementMode;
  }>;
}
export interface DocxReplacementPlan {
  readonly unlocated: ReadonlyArray<{ readonly pageIndex: number; readonly bbox: BoundingBox }>;
  readonly imageCovers: ReadonlyArray<ImageCoverRequest>;
  // y el plan de texto, opaco, que consume writeCleanDocx
}
export function planDocxReplacements(input: {
  readonly cleanPackage: ArrayBuffer;
  readonly alignment: DocxAlignment;
  readonly pages: ReadonlyArray<Page>;            // las del Document, con las de origin "unseen-text"
  readonly replacements: ReadonlyArray<Replacement>;
}): Promise<DocxReplacementPlan>;

// §6.7
export function writeCleanDocx(input: {
  readonly cleanPackage: ArrayBuffer;
  readonly plan: DocxReplacementPlan;             // con unlocated vacío
  readonly coveredImages: ReadonlyMap<string, { readonly bytes: Uint8Array; readonly mime: "image/png" | "image/jpeg" }>;
}): Promise<ArrayBuffer>;

// §6.8
export type DocxVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly check: "value" | "part" | "structure" };
export function verifyCleanDocx(
  docx: ArrayBuffer,
  originalValues: ReadonlyArray<string>,
): Promise<DocxVerifyResult>;

// §11
export type OoxmlErrorReason = "zip" | "xml" | "structure" | "alignment";
export class OoxmlError extends Error {
  readonly reason: OoxmlErrorReason;
}
```

Los tipos de este paquete no son de `Contracts.md`: no cruzan entre motores
como tipos. La alineación cruza como `ArrayBuffer` (§6.5) y el Orchestrator
no la lee (ADR-243 §9, punto 1).

### 6.1 ZIP

- Lee el directorio central, no los encabezados locales. Admite `stored` y
  `deflate`; otro método es `OoxmlError("zip")`.
- Rechaza un nombre con `..`, con barra inicial o repetido, y un tamaño
  descomprimido que no coincide con el declarado: `OoxmlError("zip")`.
- Escribe con `deflate-raw` y CRC32 propio, sin comentarios, sin campos
  extra y con la fecha fija `1980-01-01 00:00`, para que dos escrituras del
  mismo contenido den los mismos bytes.

### 6.2 `cleanDocx`

Aplica ADR-243 §1 tal cual. La lista es cerrada: lo que no está en «queda»
no entra.

- **Queda**: `word/document.xml`, estilos, numeración y tema; `fontTable.xml`
  sin fuentes incrustadas; `settings.xml` con una lista blanca de elementos;
  los encabezados y pies que se usan (`headerReference`, `titlePg`,
  `evenAndOddHeaders`); las notas que alguna referencia usa; las imágenes
  ráster recodificadas con el `ImageRecoder`; las vectoriales (EMF, WMF, SVG)
  sin sus metadatos; los gráficos sin su libro incrustado; los diagramas; y
  `[Content_Types].xml` y las relaciones, rearmados con lo que queda.
- **Se va**: todo lo demás de la lista de ADR-243 §1, incluidos `docProps`,
  `customXml` y `w:dataBinding`, comentarios y `people.xml`, glosario,
  macros, OLE (su vista previa queda como imagen), ActiveX, `webSettings`,
  `mc:Fallback`, `w:rsid*`, `w14:paraId`, `w14:textId`, `w15:docId`, de
  `settings.xml` `w:rsids`, `w:docVars`, `w:attachedTemplate`, `w:mailMerge`
  y la protección, el texto oculto (también por estilo), los destinos
  externos de los hipervínculos, los marcadores que no referencia un
  `w:anchor` (los que quedan se llaman `_bm1`, `_bm2`…), `descr` y `title`
  de las imágenes, el nombre de cada objeto (pasa a «Objeto N») y las partes
  de un tipo de relación desconocido.
- **Se resuelve**: los cambios se aceptan (lo insertado entra; lo borrado,
  las filas borradas y los cambios de formato salen), y los campos se
  congelan a su resultado guardado, salvo `PAGE`, `NUMPAGES`, `SECTIONPAGES`
  y `SECTION`.
- **Después del recodificador**, se sacan de un JPEG los segmentos `APP1` a
  `APP15` y `COM` antes del scan, porque el codificador de Chromium agrega un
  perfil sRGB (ADR-243 §1). En un PNG no quedan `iCCP`, `eXIf`, `tEXt`,
  `zTXt`, `iTXt` ni `tIME`.
- **Vectoriales**: en un EMF se vacía la descripción de la cabecera y se
  quitan los registros de comentario que no son EMF+; en un SVG, `metadata`,
  `title`, `desc` y los comentarios.

Si el paquete no es un `.docx` válido (falta `word/document.xml`, el
contenido no es XML bien formado), `OoxmlError("structure")` o `("xml")`.

### 6.3 `alignDocx` y `buildUnseenDocx`

ADR-243 §3 y §4.

- **El texto del paquete**: el lector recorre el cuerpo, los encabezados y
  pies, las notas, los cuadros de texto, las formas y las ecuaciones
  (`m:t` partido en runs incluido), con tabulaciones, saltos y símbolos. Cada
  carácter sabe su parte, su nodo y su posición.
- **El texto de las páginas**: las palabras de `pages` en orden, unidas como
  `Page.text`.
- **Dos pasadas**:
  1. el cuerpo contra todas las páginas, con anclas únicas (patience diff);
  2. lo que no es cuerpo contra lo que quedó sin par, por unidad. Una unidad
     que aparece en muchas páginas, como un encabezado, apunta siempre al
     mismo lugar del XML.
- **Lo que no se puede decidir no se elige**: queda ambiguo, con todos sus
  candidatos (§6.6).
- **El documento completo de una vez**, sin tramos de páginas (ADR-243 §3).
- **Los pedazos**: tramos consecutivos del texto del paquete sin par en las
  páginas, sin contar los que no tienen letras ni dígitos, ni los resultados
  guardados de `PAGE`, `NUMPAGES`, `SECTIONPAGES` y `SECTION`. Cada pedazo
  lleva la etiqueta de dónde viene, y la alineación guarda su rango en el
  XML.
- **`buildUnseenDocx`**: un `.docx` mínimo, A4, con un párrafo por pedazo:
  la etiqueta en negrita, «: » y el texto, en Liberation Sans 11 pt. Sin
  `docProps` ni nada que no haga falta para que LibreOffice lo abra.

### 6.4 Imágenes

- `listMediaParts` devuelve las partes de `word/media` del paquete limpio.
- `matchImages` compara cada `DrawnImage` con cada miniatura de `word/media`,
  probando los 8 giros y espejos, porque LibreOffice hornea el giro y el
  espejo en los píxeles (ADR-243 §5, paso 5). Un giro que no es múltiplo de
  90° se toma del XML del dibujo.
- **Sin ambigüedad**, la imagen queda ubicada en una parte. **Con varias
  partes iguales**, queda ubicada en todas. **Sin ninguna**, queda sin
  ubicar, y una tapa sobre ella cuenta como reemplazo sin ubicar (§6.6).

### 6.5 El formato de la alineación

- Bytes versionados: un encabezado con la versión del formato y, después, el
  mapa de cada carácter de las páginas a su lugar del XML, los pedazos con su
  etiqueta, su texto y su rango, y las imágenes ubicadas con su
  transformación.
- Solo lo escribe `encodeAlignment` y solo lo lee `decodeAlignment`. Ningún
  otro paquete interpreta esos bytes.
- `decodeAlignment` de una versión que no conoce, o de bytes truncados, es
  `OoxmlError("alignment")`.
- Ocupa del orden de 10 bytes por carácter del documento; no guarda el texto
  del cuerpo, que ya está en el paquete y en las páginas.

### 6.6 `planDocxReplacements`

ADR-243 §5, pasos 1, 2, 5 y 6.

1. **Cada `Replacement` se ubica por sus palabras**: las palabras de su
   página que tocan sus fragmentos (`fragments ?? [bbox]`), su posición en el
   texto de la página, y la alineación hasta el XML.
   - **En una página del documento**: por el mapa de la alineación.
   - **En una página `origin: "unseen-text"`**: se alinea el texto de esa
     página con el de los pedazos que guarda la alineación, en orden, y de
     ahí al rango de cada pedazo.
   - **Ambiguo entre copias idénticas**: se reemplazan todas.
   - **Si algún carácter no llega al XML**, el reemplazo queda en
     `unlocated`. Un reemplazo a medias no existe.
2. **Un reemplazo sobre palabras de OCR adentro de una imagen ubicada** es
   una tapa de imagen: va a `imageCovers` con su caja pasada a píxeles de la
   parte por la transformación inversa. Si la parte se usa en dos dibujos,
   queda tapada en los dos.
3. **Queda en `unlocated`**:
   - una tapa sobre una imagen sin ubicar;
   - una tapa sobre el texto de una imagen vectorial, que está adentro de la
     imagen (ADR-243 §1).
4. **El texto del reemplazo** es `replacementValue`. En modo `redact` es un
   bloque de `█` (U+2588) del largo del `originalValue`, contado en
   caracteres (code points), espacios incluidos (ADR-243 §5, paso 6).

### 6.7 `writeCleanDocx`

ADR-243 §5, pasos 3, 4 y 7.

- **Precondición**: `plan.unlocated` vacío, y cada `imageCovers[i].partName`
  presente en `coveredImages`. Si no, `OoxmlError("structure")`: el Export
  Engine no llega acá con un reemplazo sin ubicar.
- **En su lugar**: el texto del reemplazo toma el formato del primer run del
  tramo; los demás runs pierden ese texto, con sus tabulaciones, saltos,
  guiones no separables y símbolos.
- **Por valor**: cada `originalValue` se reemplaza, además, en todo el XML
  que queda, con límites de palabra: en el texto de cada párrafo cruzando
  runs, en cada nodo de texto, y en los atributos que llevan texto
  (`v:textpath@string`, `w:alias`, `w:tag`, `w:lvlText`, `w:listItem`), en
  todas las partes, también gráficos y diagramas. Va el mismo texto de
  reemplazo que su grupo.
- **Lineal**: cada valor se busca solo donde empieza un token igual a su
  primer token, con un índice por token.
- **Imágenes**: los bytes de `coveredImages` reemplazan a los de su parte, y
  se vuelven a sacar los segmentos de §6.2.
- Escribe con `writeZip` (§6.1).

### 6.8 `verifyCleanDocx`

ADR-243 §6. **Es independiente del lector**: recorre todas las partes con
su propio paso por el XML y no usa nada de §6.3.

- **`check: "value"`**: algún `originalValue`, normalizado (NFKC, minúsculas,
  espacios colapsados), aparece como hallazgo:
  - **dónde**: en cada nodo de texto de cada parte, salvo una lista negra de
    nodos que no son texto (`w:instrText`, `w:delInstrText`, `wp:posOffset`,
    `wp:align`, `wp14:pct*`, `cdr:x`, `cdr:y`, `c:f`, `c:formatCode`,
    `c:separator`); en el texto de cada párrafo, armado con `w:t`,
    `w:delText`, `a:t`, `m:t` y `c:v`; y en los atributos con texto de §6.7.
    Un nodo de texto que la lista negra no nombra cuenta igual;
  - **qué es un hallazgo**: un valor con letras, sin letra ni número a los
    costados; un valor numérico (solo dígitos y separadores, con 5 o más
    dígitos), comparando solo sus dígitos y sin otro dígito a los costados.
    Una subcadena de una palabra más larga, un valor de enumeración o el
    nombre de una parte no son hallazgo.
- **`check: "part"`**: una parte fuera de la lista de §6.2, una relación
  externa, o una relación de un tipo que la lista no conoce.
- **`check: "structure"`**: un `w:rsid*`, `w:ins`, `w:del`, `w:moveFrom`,
  `w:moveTo`, `mc:Fallback` o comentario; un marcador que no se llama
  `_bmN`, o con id repetido o sin par; un hipervínculo sin `w:anchor`; un
  `a:srcRect`; un JPEG con `APP1` a `APP15` o `COM`, o un PNG con los trozos
  de §6.2.
- **Lineal**, con el mismo índice por token que §6.7.

El resultado no lleva el valor ni dónde apareció.

---

## 7. Eventos que emite

Ninguno. Es un paquete puro (ADR-243 §2).

---

## 8. Eventos que consume

Ninguno.

---

## 9. Entradas

- `cleanDocx`, `alignDocx`, `listMediaParts`, `planDocxReplacements` y
  `writeCleanDocx` reciben un ZIP; uno vacío o que no es ZIP es
  `OoxmlError("zip")`.
- `alignDocx`: `pages` en el orden del PDF, sin las páginas extra, que
  todavía no existen.
- `planDocxReplacements`: `pages` con las de `origin: "unseen-text"` al
  final, y `replacements` de esas páginas también.
- `verifyCleanDocx`: `originalValues` sin repetir; vacío devuelve
  `{ ok: true }` si la estructura y las partes pasan.
- Ninguna función muta lo que recibe (P-5).

---

## 10. Salidas

- **El paquete limpio** abre en LibreOffice como abría el original: en el
  corpus abrieron 2.089 de 2.090, y el que no abre tampoco abría como
  original (ADR-243 §1).
- **`textLength`** es el largo del mismo texto que lee §6.3.
- **El Word limpio** abre en LibreOffice y da en el validador de Microsoft
  los mismos errores que el paquete limpio: el escritor no agrega ninguno
  (ADR-243 §6).
- **Determinismo**: las mismas entradas dan los mismos bytes.

---

## 11. Errores posibles

| `reason` | Cuándo | Qué hace quien llama |
|---|---|---|
| `"zip"` | ZIP ilegible, método desconocido, nombre inválido o tamaño que no coincide (§6.1) | Convert: `OFFICE_CONVERT_FAILED` con `phase: "clean"` o `"align"`; Export: `EXPORT_FAILED` |
| `"xml"` | una parte que tiene que ser XML no está bien formada | idem |
| `"structure"` | falta una parte obligatoria, o se viola una precondición (§6.7) | idem |
| `"alignment"` | `decodeAlignment` no reconoce los bytes (§6.5) | Export: `EXPORT_FAILED` |

`OoxmlError.message` nunca lleva texto del documento, nombres de partes del
usuario ni valores. Una verificación que no pasa no es un error: es
`{ ok: false }`, y el Export Engine la convierte en
`EXPORT_DOCX_VERIFY_FAILED`.

---

## 12. Consideraciones de rendimiento

Medido en el prototipo (`Plan_1.2.md` §8.9, `Word_Limpio_Escritura_2026-11-24.md`,
sin documentos reales), en el Worker salvo donde dice Node:

- Limpiar: 3,4 ms de mediana y 43 ms en el p99.
- Alinear: unos 0,7 s y 240 MB por millón de caracteres, lineal; 2,9 s y
  975 MB con cuatro millones. **La implementación tiene que ocupar menos que
  el prototipo** (ADR-243 §3): el techo del Word limpio depende de esto.
- Escribir: 2,6 ms de mediana; verificar, 2,0 ms. En Node, escribir da
  37 ms en el p99 y verificar 24 ms.
- Con el índice por token, verificar 2 millones de caracteres tarda 129 ms.
  Buscar cada valor en cada texto tardaba casi un minuto.

El prototipo de referencia, sin valor normativo, está fuera del repo, en
`C:\Anonly\spikes\lowa\harness\word-limpio-escritura\`: `limpiador.mjs`,
`lector.mjs`, `align.mjs`, `escritor.mjs`, `gate.mjs`, `extra.mjs`,
`zipw.mjs` y `xmlfull.mjs`.

---

## 13. Casos límite

1. **Un Word con cambios**: lo insertado entra, lo borrado y las filas
   borradas no.
2. **Un campo `FILENAME`** queda congelado a su resultado y se ve; un `PAGE`
   queda vivo.
3. **Un encabezado que no se usa** no entra; uno que se usa en muchas
   páginas apunta al mismo lugar del XML.
4. **Una nota sin referencia** no entra.
5. **Un `mc:AlternateContent`**: queda el `mc:Choice`.
6. **Un JPEG con EXIF** sale recodificado y sin `APP1` a `APP15` ni `COM`.
7. **Una imagen con `a:srcRect`** sale recortada y sin `srcRect`.
8. **Un GIF animado** sale como PNG con su primer cuadro; **un TIFF**, como
   PNG.
9. **Un EMF con descripción y comentarios**: sale con la descripción vacía y
   solo los comentarios EMF+.
10. **Un índice con `w:anchor`**: sus marcadores quedan como `_bmN` y siguen
    resolviendo.
11. **Una ecuación partida en varios runs**: se lee, se reemplaza y se
    verifica.
12. **Un cuadro de texto que no se dibuja**: es un pedazo con la etiqueta
    «Cuadro de texto».
13. **Una detección entre copias idénticas**: se reemplazan todas.
14. **Una detección que cruza tres runs**: toma el formato del primero.
15. **Un valor que aparece en un `w:alias` o en un WordArt**
    (`v:textpath@string`): el reemplazo por valor lo cubre.
16. **Un valor adentro de una palabra más larga**: no se reemplaza ni es
    hallazgo (limitación de ADR-243 §6).
17. **Un DNI con puntos en un lugar y sin puntos en otro**: la verificación
    los compara por dígitos.
18. **Una tapa sobre una imagen sin ubicar o sobre el texto de una
    vectorial**: va a `unlocated`.
19. **Una imagen usada en dos dibujos**: la tapa queda en los dos.
20. **`redact` sobre «Juan Pérez»**: diez `█`.
21. **Un documento hecho de la letra `x`**: la verificación puede dar
    `{ ok: false }` sin un dato real (3 de 2.089 en el corpus); falla
    cerrado.
22. **Una alineación de otra versión del formato**: `OoxmlError("alignment")`.

---

## 14. Casos de prueba

Corren en Node 22, sin mocks: `CompressionStream` y `DecompressionStream`
existen. Los `.docx` de prueba se arman en el test con `writeZip` y XML
escrito a mano, con datos inventados. El `ImageRecoder` de los tests es un
doble que devuelve un PNG fijo y registra lo que recibe.

| Nombre | Archivo | Tipo | Notas |
|---|---|---|---|
| `readZip and writeZip round-trip byte for byte` | `contract.test.ts` | contract | §6.1, con la fecha fija |
| `the clean package keeps only the closed list` | `contract.test.ts` | contract | §6.2: un `.docx` con todas las partes de «se va»; quedan solo las de «queda» |
| `alignDocx returns the same pieces for the same input` | `contract.test.ts` | contract | §10, determinismo |
| `encodeAlignment and decodeAlignment round-trip` | `contract.test.ts` | contract | §6.5 |
| `the clean Word passes its own verification` | `contract.test.ts` | contract | §6.7 y §6.8 |
| `verification finds every value in an unreplaced package` | `contract.test.ts` | contract | ADR-149: el gate no está vacío |
| `tracked changes are accepted and deletions leave the package` | `unit.test.ts` | unit | caso 1 |
| `fields are frozen except page numbers` | `unit.test.ts` | unit | caso 2 |
| `unused headers and orphan notes are dropped` | `unit.test.ts` | unit | casos 3 y 4 |
| `mc:Fallback is dropped and mc:Choice kept` | `unit.test.ts` | unit | caso 5 |
| `JPEG APP segments and PNG text chunks are stripped after recoding` | `unit.test.ts` | unit | caso 6 |
| `srcRect is applied as a real crop` | `unit.test.ts` | unit | caso 7: el recodificador recibe `crop` y el XML sale sin `srcRect` |
| `EMF description and non EMF+ comments are removed` | `unit.test.ts` | unit | caso 9 |
| `anchored bookmarks are renamed and still resolve` | `unit.test.ts` | unit | caso 10 |
| `split equation runs are read, replaced and verified` | `unit.test.ts` | unit | caso 11 |
| `a header repeated on many pages maps to one place` | `unit.test.ts` | unit | caso 3, segunda pasada |
| `an undrawn text box becomes a labeled piece` | `unit.test.ts` | unit | caso 12 |
| `buildUnseenDocx writes one paragraph per piece` | `unit.test.ts` | unit | §6.3 |
| `matchImages finds a rotated and mirrored image` | `unit.test.ts` | unit | §6.4 |
| `a replacement across three runs keeps the first run format` | `unit.test.ts` | unit | caso 14 |
| `value replacement covers text attributes` | `unit.test.ts` | unit | caso 15 |
| `ambiguous copies are all replaced` | `unit.test.ts` | unit | caso 13 |
| `a replacement on an unseen-text page goes back to its piece` | `unit.test.ts` | unit | §6.6, paso 1 |
| `redact writes one block per character of the original` | `unit.test.ts` | unit | caso 20, con code points |
| `an image cover is mapped to part pixels with the inverse transform` | `unit.test.ts` | unit | §6.6, paso 2, y caso 19 |
| `a cover on an unlocated or vector image is unlocated` | `edge.test.ts` | edge | caso 18 |
| `a partially located replacement is unlocated` | `edge.test.ts` | edge | §6.6, paso 1 |
| `writeCleanDocx refuses a plan with unlocated replacements` | `edge.test.ts` | edge | §6.7, precondición |
| `a substring of a longer word is not a finding` | `edge.test.ts` | edge | caso 16 |
| `numeric values are compared by digits` | `edge.test.ts` | edge | caso 17 |
| `an unknown text node counts in verification` | `edge.test.ts` | edge | §6.8: independencia del lector |
| `verification reports part and structure failures without the value` | `edge.test.ts` | edge | §6.8 |
| `a zip with a parent path or a repeated name is rejected` | `edge.test.ts` | edge | §6.1 |
| `an unknown alignment version is rejected` | `edge.test.ts` | edge | caso 22 |
| `errors never carry document text` | `edge.test.ts` | edge | §11 |
| `verification and value replacement stay linear` | `edge.test.ts` | edge | §6.7: 2 millones de caracteres por debajo de 1 s |

Cobertura ≥ 85 % de líneas del paquete (R-13), con su glob en
`vitest.config.ts` en el mismo PR.

---

## 15. Checklist de implementación

- [ ] 1. Paquete `ooxml` con `package.json` y `tsconfig`, sin dependencias
  externas, y su glob de cobertura.
- [ ] 2. ZIP (§6.1) y tokenizador de XML con edición en el lugar.
- [ ] 3. `cleanDocx` con la lista cerrada (§6.2).
- [ ] 4. Lector con el mapa de caracteres y `alignDocx` (§6.3).
- [ ] 5. `buildUnseenDocx`, `listMediaParts` y `matchImages` (§6.3 y §6.4).
- [ ] 6. Formato de la alineación (§6.5).
- [ ] 7. `planDocxReplacements` y `writeCleanDocx` con el índice por token
  (§6.6 y §6.7).
- [ ] 8. `verifyCleanDocx`, independiente del lector (§6.8).
- [ ] 9. Tests de §14.
- [ ] 10. `CLAUDE.md` y `ai/Code_Standards.md` §12 nombran el paquete como
  importable por los motores.

---

## Referencias

- ADR-243: el Word limpio, con sus precisiones de §9.
- ADR-240 §5: la enmienda de la última versión del Word.
- `core/Convert_Engine.md` §6.6 y §6.7; `core/Export_Engine.md`: quienes lo
  usan.
- `roadmap/formatos/Word_Limpio_Alineacion_2026-11-24.md` y
  `Word_Limpio_Escritura_2026-11-24.md`: las mediciones.
