# Spike de imágenes sueltas (1.2): INFORME

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\imagenes\results\INFORME.md` el 2026-11-23. Los scripts,
> el corpus y las muestras de terceros quedan fuera del repo. Qué decide el
> planificador con esto: `Plan_1.2.md` §7 y §8.

Fecha: 2026-11-23. Máquina: Windows 11, i5, 15,7 GB. Electron del repo 44.11.5 (Chrome 152.0.7977.169, V8 15.2). Harness Electron con CSP, COOP/COEP y `app://` copiados de `security.ts`. Workers clásicos servidos por `app://` **con la CSP del documento en su respuesta** (verificado: `new Function` y `eval` dan error de CSP dentro del Worker; sin esa cabecera el Worker los permite).

**Qué sale solo de sintéticos:** todo. No había `ANONLY_REAL_DOC_R*` definidas (el harness las soporta pero corrió con 0 reales). El corpus es sintético (texto inventado, canvas) más muestras de terceros para formatos que no se pueden generar (sección 9). Las memorias son el delta de bytes privados de los procesos renderer (muestreo cada 25 ms con `app.getAppMetrics`), no un pico exacto; en el Worker `performance.memory` no existe.

## 1. Veredictos por pregunta

| # | Pregunta | Veredicto |
|---|---|---|
| 1 | Qué decodifica Electron solo, en Worker | **Parcial.** Nativo: PNG, JPEG (incl. gris, CMYK, progresivo), WebP, GIF, BMP (1/4/8/24/32 bits y RLE4/RLE8), AVIF, APNG. **No**: TIFF, HEIC/HEIF. |
| 2 | EXIF | **Sí, se aplica sola.** Las 8 orientaciones salen correctas. |
| 3 | GIF/WebP animados | **Sí.** `ImageDecoder` da 3 cuadros; `createImageBitmap` toma el primero. |
| 4 | TIFF con `utif2` | **Sí con un parche** (CMYK pide `window`). |
| 5 | HEIC con `libheif-js` | **Sí.** WASM bajo CSP sin `unsafe-eval` y bajo COOP/COEP. Hay que pedir la imagen primaria explícitamente. `nativeImage`: no sirve. |
| 6 | Armar el PDF | **Sí** con las dos `pdf-lib`; mismo código, salida equivalente. |
| 7 | Bombas | **Parcial:** ningún caso colgó ni mató el renderer, pero 400 MP pican 1,5 GB. Se necesita tope por cabecera. |
| 8 | Resumen por formato | Sección 3. |

### 1. Soporte nativo (Worker, CSP)
`ImageDecoder.isTypeSupported`: png, jpeg, webp, gif, bmp, avif, apng = true; `image/x-ms-bmp`, tiff, heic, heif, x-icon, svg = false. `createImageBitmap(blob)` coincide (TIFF y HEIC: `InvalidStateError`). JPEG aritmético (SOF9): falla en las dos. `OffscreenCanvas` y `convertToBlob` están en el Worker; `convertToBlob` codifica png, jpeg y webp (avif, bmp y gif devuelven PNG sin avisar). `VideoFrame` y `SharedArrayBuffer` disponibles, `crossOriginIsolated=true`.
Quirk: `ImageDecoder` informa `animated=true` para un GIF de un solo cuadro (`frameCount=1`); usar `frameCount`. Los archivos: `q1-caps.json`.

### 2. EXIF (`q2-exif.json`)
JPEG 600x400 con marcadores rojo (arriba izq. guardado) y azul (arriba der.), orientaciones 1 a 8: `createImageBitmap` (default y `from-image`) e `ImageDecoder` aplican la orientación y dan las dimensiones finales (400x600 para 5 a 8). `ImageDecoder` conserva `codedWidth` sin rotar y `displayWidth` rotado. **`imageOrientation:'none'` no la desactiva** (Chrome 152 da lo mismo): no hay forma nativa de leer los píxeles sin rotar. Consecuencia: el JPEG pasa tal cual solo si orientación = 1 (leída con un parser de cabecera, ver `harness/page/header.js`); si no, decodificar y recodificar.

### 3. Animados (`q3-anim.json`)
`anim3.gif` 3 cuadros, `anim3.webp` (armado a mano, 3 cuadros) 3 cuadros, duración 200 ms. `decode({frameIndex:0})` y `createImageBitmap` dan el primer cuadro (mismo checksum que el cuadro 1 suelto).

### 4. `utif2` 4.1.0 (`q4-tiff*.json`)
- MIT. Depende de `pako` ^1. `UTIF.js` 95.737 B (30,8 KB gzip); bundle IIFE minificado con pako 109 KB (39 KB gzip). Sin `eval`/`new Function` (grep en el fuente y en el bundle). Corre en Worker con CSP.
- **Defecto:** `toRGBA8` de CMYK (photometric 5) hace `window.UDOC` y tira `ReferenceError: window is not defined` en un Worker. Con `self.window = self` antes de usarlo funciona (conversión CMYK simple sin ICC: el azul puro se desplaza).
- Multipágina: 3 páginas OK (G4 y LZW). El TIFF de Pillow `g4-multi` (3 págs. 3307x4677) también.
- Compresiones leídas bien: ninguna, LZW, PackBits, Deflate (zip), CCITT G3, G4, RLE (CCITT), JPEG-en-TIFF (photometric 2 y 6), 8, 16 bits gris, 16 bits RGBA, CMYK (con parche). Orientación TIFF (tag 274): `utif2` **no la aplica** (se lee en `ifd.t274`).
- Resolución: lee `t282`/`t283` (racionales `[num,den]`) y `t296` (unidad 2=pulgada, 3=cm). Hay casos raros (denominador enorme, unidad cm): hay que convertir con cuidado.

Tiempo y memoria de una página A4 a 300 dpi (2480x3508), decodificar + `toRGBA8`, Worker nuevo por caso:

| Compresión | Archivo | Decodif. ms | RGBA ms | Pico renderer MB |
|---|---|---|---|---|
| Ninguna RGB24 | 26,1 MB | 32 | 27 | 84 |
| LZW RGB24 | 8,6 MB | 118 | 27 | 68 |
| PackBits RGB24 | 34,1 MB | 70 | 27 | 92 |
| Deflate RGB24 | 7,1 MB | 184 | 27 | 88 |
| **CCITT G4 1 bit** | 0,41 MB | **556** | 26 | 36 |
| CCITT G3 1 bit | 0,37 MB | 141 | 29 | 37 |
| RLE 1 bit | 0,56 MB | 5 | 26 | 36 |
| JPEG-en-TIFF | 1,2 MB | 240 a 250 | 26 a 37 | 113 |
| Gris 16 bits (ninguna) | 17 MB | 21 | 31 | 67 |
| RGBA 16 bits | 69,6 MB | 89 | 37 | 168 |
| CMYK LZW (con parche) | 4 MB | 111 | 91 | 78 |

G4 es el caso típico de escáner y el más lento (~0,55 s por página). TIFF G4 de 3 páginas: 1,73 s total. Un TIFF de 10.000 IFD de 8x8: `UTIF.decode` 13 ms.

### 5. HEIC con `libheif-js` 1.23.5 (`q5-*.json`)
- **Licencia: LGPL-3.0** (`package.json` y `libheif-wasm/LICENSE`). El wasm contiene libde265 (cadenas `de265`), `dav1d` y `openjpeg` (por grep de cadenas). Sin `eval`/`new Function` en `libheif-wasm/*.js` ni `libheif/libheif.js`.
- Builds: `libheif-wasm/libheif.js` 91 KB (29 KB gz) + `libheif.wasm` 1,46 MB (483 KB gz) archivo aparte; `libheif-bundle.js` 2,04 MB (717 KB gz) con el wasm en base64; asm.js `libheif/libheif.js` 3,19 MB (764 KB gz).
- Corre con la CSP del repo (`'wasm-unsafe-eval'`, sin `unsafe-eval`), bajo COOP/COEP, con el wasm como archivo separado (`WebAssembly.instantiateStreaming` con MIME `application/wasm`), con el bundle y con asm.js. Cero intentos de red.
- Rendimiento. HEIC de 12 MP codificado con el HEVC de Windows desde un JPEG sintético (4000x3000, 4,5 MB):

| Build | Init ms | Decodificar ms | Pico renderer MB |
|---|---|---|---|
| wasm (archivo aparte) | 27 | 958 | 137 |
| bundle | 34 | 955 | 143 |
| asm.js | 111 | 2051 | 215 |

  A4 (2480x3508): 598 ms. 48 MP (8000x6000): 3,3 s decodificando, pico del camino completo a PDF 1,4 a 1,7 GB (sección 6).
- **Primaria**: `HeifDecoder.decode()` devuelve **todas** las imágenes de nivel superior y la primaria no es la primera (grid `C007`: 5 imágenes, la primaria es la quinta, 2560x1440; `C022` igual). Hay que usar `heif_context_get_primary_image_handle(decoder.decoder)` + `new HeifImage(handle)`; funciona. Grid de 2x2 o 3x2: libheif los compone (primaria 2560x1440 y 1440x960).
- Transformaciones: `imir` aplicado (`C042`: igual a `C002` volteado verticalmente, diferencia media 0); rotación aplicada (`C008`: 720x1280 desde 1280x720; mejor ajuste rotación 90° antihoraria, diferencia 31 contra ~100 de las demás, no 0 porque el archivo no es idéntico a `C002`); `clap` aplicado (300x300). Falla: `C039` (iden de iden con clap+irot) devuelve error («Decoding image failed»), sin crash.
- **Patentes HEVC (solo hechos y fuentes, sin conclusión):**
  - Access Advance: su programa «HEVC Advance» cubre «Devices, Software, and Commercial Content Distribution on Physical Digital Media»; las tarifas están en una sección aparte y la página no dice cómo trata al software gratis (https://accessadvance.com/licensing-programs/hevc-advance/, leído hoy). **[NO CONFIRMADO]** el tratamiento exacto del software distribuido gratis.
  - Via LA (programa HEVC/VVC, adquirido por Access Advance el 2025-12-15): regalías por unidad vendida a usuarios finales por el licenciatario; primeras 100.000 unidades por año a 0 USD; desde la 100.001 0,30 USD (R1) o 0,20 USD (R2); tope anual 30.000.000 USD; la página no menciona software ni open source (https://www.via-la.com/licensing-2/hevc-vvc/).
  - libde265/libheif: su README declara solo la licencia LGPL y no menciona patentes (https://github.com/strukturag/libde265). La licencia LGPL de código no otorga licencia de patentes: lo escribo como hecho general **[CONOCIMIENTO PREVIO, no verificado en esta sesión]**.
  - En esta máquina existen `Microsoft.HEIFImageExtension` 1.2.65.0 y `Microsoft.HEVCVideoExtension` 2.5.48.0 instaladas, y el codificador HEIF de Windows las usó; son componentes del sistema, no del Electron.
- **`nativeImage.createFromBuffer` en main (Windows, con esas extensiones instaladas): vacío** para HEIC, HEIF, AVIF y TIFF (solo PNG funciona). No sirve como alternativa.
- 12 MP real de cámara: no hay; el de 12 MP es sintético codificado por Windows (distinto de un iPhone, que usa mosaico de 512x512). El mosaico se probó con `C007`, `C022`, `C025` (libheif los compone). **[NO CONFIRMADO]** con un HEIC de iPhone real.

### 6. Armado del PDF (`q6*-pdf.json`, `q6*-verify.json`)
Reglas probadas: una página por imagen; tamaño por resolución declarada si está en 100 a 1200 dpi (leída de PNG `pHYs`, JFIF/EXIF, BMP, TIFF); si no, lado largo 841,89 pt. Código: `harness/src/pdfbuild.js`, idéntico para las dos librerías (alias de esbuild).

**Verificación con `pdfjs-dist` 4.10.38 del repo:** en todos los casos válidos (26 PDF, 2 librerías) cada página tiene el tamaño esperado (error < 0,02 pt), exactamente un `paintImageXObject`, ninguna otra operación de pintura, ancho y alto nativos de la imagen (ADR-163) y la CTM acumulada cubre la página (`[W,0,0,H,0,0]`). `pdf.js` además decodificó la imagen (misma fracción de oscuros que el original). Excepciones esperadas: el JPEG con orientación 6 se rechaza antes de armar; el JPEG aritmético se arma pero `pdf.js` no lo decodifica (ni el navegador).

`embedJpg` (verificado con `pdf.js`): acepta baseline, **progresivo**, escala de grises (DeviceGray), CMYK (DeviceCMYK; `pdf.js` lo decodificó a RGB). Acepta sin avisar un JPEG aritmético (SOF9), que luego no se decodifica: hay que decodificar con `createImageBitmap` antes.

Tiempo (ms, Worker) y memoria; `total` incluye decodificar, recodificar y armar. Pico = delta renderer MB.

| Caso | Camino | pdf-lib 1.17.1 total / pico / salida | @cantoo 2.11.1 total / pico / salida |
|---|---|---|---|
| Foto JPEG 12 MP | JPEG tal cual | 19 ms / 15 MB / 3,19 MB | 22 ms / 12 MB / 3,19 MB |
| Foto JPEG 12 MP | decodificar a PNG sin pérdida | 2936 ms / 295 MB / 26,3 MB | 2437 / 383 / 25,1 MB |
| Foto JPEG 12 MP | decodificar a RGB Flate | 2048 / 208 / 26,3 MB | 1218 / 184 / 25,1 MB |
| Escaneo PNG A4 300 dpi | PNG recodificado | 3374 / 177 / 6,79 MB | 2799 / 258 / 5,82 MB |
| Escaneo PNG A4 300 dpi | RGB Flate | 2897 / 129 / 6,79 MB | 2133 / 149 / 5,82 MB |
| Escaneo JPEG A4 300 dpi | tal cual | 14 / 7 / 1,19 MB | 12 / 6 / 1,19 MB |
| TIFF G4 3 páginas | utif2 a PNG | 3568 / 350 / 1,45 MB | 4202 / 338 / 1,38 MB |
| TIFF G4 3 páginas | utif2 a RGB Flate | 3163 / 186 / 1,45 MB | 3581 / 269 / 1,38 MB |
| HEIC 12 MP | libheif a PNG | 3934 / 412 / 26,2 MB | 3293 / 486 / 25,1 MB |

El PNG se recodifica con `convertToBlob` (nativo) + `embedPng` (UPNG + deflate de pdf-lib); «RGB Flate» es la alternativa de meter los píxeles con `context.flateStream` sin pasar por PNG. Sobre fondo blanco (se aplana el alfa). Los PNG de las salidas no son más chicos que el original (el escaneo ruidoso pesa 12,8 MB como PNG y 6,8 MB en el PDF por la compresión Flate). El JPEG tal cual es 100 a 200 veces más rápido y no pierde calidad: recomendado cuando orientación = 1.

**Comparación `pdf-lib` 1.17.1 contra `@cantoo/pdf-lib` 2.11.1**
- Mismo código sin cambios: **sí** (misma API; solo cambió el alias).
- Salida: equivalente (mismo diccionario de imagen, misma estructura de objetos, páginas e imágenes idénticas para `pdf.js`; cambia el nombre interno del XObject y el tamaño por el deflate: cantoo ~5 a 15 % más chico en PNG/Flate y ~25 % más rápido en Flate).
- Bundle del código de armado (esbuild 0.25.12 del repo, IIFE minificado): pdf-lib 525.038 B (208 KB gzip); cantoo 597.637 B (252 KB gzip). Incluye las fuentes estándar en las dos (no se hizo tree-shaking).
- `eval`/`new Function` en `dist` (UMD y ESM) y en los bundles: **ninguna** de las dos.
- Dependencias que suma el fork: `culori`, `fflate`, `html-entities`, `node-html-better-parser`, `tslib` (pdf-lib: `pako`, `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `tslib`). Ambas MIT. `Producer`/fechas por defecto aparecen en los dos (no se tocó `updateMetadata`).

### 7. Bombas de descompresión (`q7-*.json`)
Todo en Worker, un Electron por caso. Memoria = pico renderer sin dibujar (`bitmap-nodraw`).

| Archivo | Tamaño archivo | Cabecera | `createImageBitmap` | `ImageDecoder` | utif2 |
|---|---|---|---|---|---|
| PNG gris 8000² (64 MP) | 62 KB | 6 ms | 90 ms, 246 MB | igual | |
| PNG 12000² (144 MP) | 140 KB | 6 ms | 205 ms, 553 MB | | |
| PNG 16000² (256 MP) | 249 KB | 5 ms | 350 ms, 981 MB | | |
| PNG 20000² (400 MP) | 389 KB | 6 ms | 540 ms, **1,53 GB** | 415 ms, 1,53 GB | |
| PNG 23000² (529 MP) | 514 KB | | 716 ms, 2,02 GB | | |
| PNG 24000² (576 MP) | 560 KB | | **error** `InvalidStateError` en 5 ms | | |
| PNG 30000² | 875 KB | | error en 7 ms | error | |
| JPEG gris 20000² | 4,7 MB | 11 ms | 825 ms, 1,54 GB | 684 ms | |
| GIF 20000² | 296 KB | 7 ms | 710 ms, 1,53 GB | 583 ms | |
| BMP que declara 30000² sin datos | 354 B | 5 ms | error en 3 ms | error | |
| TIFF Deflate 8000² | 62 KB | 5 ms | no soporta | | decod. 147 + RGBA 154 ms, 405 MB |
| TIFF Deflate 20000² | 389 KB | 7 ms | | | decod. 797 + RGBA 1061 ms, **2,64 GB** |
| TIFF sin comprimir que declara 100000² | 1,1 KB | 5 ms | | | error limpio `Array buffer allocation failed` en 4 ms |
| TIFF de 10.000 páginas 8x8 | 1,8 MB | 15 ms | | | `decode` 13 ms, 22 MB |

- Ninguna bomba mató el renderer, y las que superan el límite fallan rápido y limpio. El límite de `createImageBitmap` coincide con 2³¹ bytes de RGBA (536,9 MP): 23000² pasa, 24000² falla.
- **Dibujar** un bitmap de más de 268 MP (límite de área del canvas de Chromium) no da error: queda vacío (20000²: `drawImage` 2 ms, píxeles en 0). El canvas es entonces el límite real de la ruta de conversión; con `convertToBlob` sobre un canvas así habría una página en blanco silenciosa.
- WebP, HEIC y TIFF con compresión LZW/PackBits enormes: no probados. WebP máximo 16383² (268 MP) por formato **[NO CONFIRMADO]**; HEIC no se pudo fabricar (necesita un codificador HEVC); libheif trae límites de seguridad propios **[NO CONFIRMADO, conocimiento previo]**.
- Una página de A4 declarada a 300 dpi tiene 8,7 MP: la ruta completa a PDF cuesta 20 a 36 bytes por píxel de pico (medido: A4 129 a 258 MB; 12 MP 184 a 486 MB; 24 MP 527 a 730 MB; 48 MP 986 a 1274 MB, y HEIC 48 MP 1,40 a 1,73 GB; JPEG tal cual a 99 MP: 33 MB).

**Tope de pixeles propuesto (decisión de producto, a confirmar):**
1. Se mide **antes de decodificar**, desde la cabecera (el parser de `header.js` cuesta 5 a 15 ms, incluso con 10.000 páginas TIFF): `ancho x alto <= 50.000.000` y lado `<= 16.384`; por página en un TIFF.
2. De dónde sale: (a) el pico medido de la ruta a PDF, 20 a 36 B/px, deja a 50 MP en 1,0 a 1,8 GB, que cabe en el techo de ADR-192 (2,5 a 3,0 GB) si la conversión ocurre antes y fuera del pico del OCR; (b) cabe un iPhone de 48 MP (8064x6048 = 48,8 MP); (c) está 5 veces por debajo de los límites duros medidos (canvas 268 MP y 16.384 por lado; bitmap 536 MP).
3. Excepción posible: el JPEG con orientación 1 que se pasa tal cual no se decodifica, y 99 MP costó 33 MB; podría tener un tope mayor (100 MP), pero el render de OCR posterior (ADR-163) lo vuelve a cargar: **[NO MEDIDO]**.
4. Tope de páginas de TIFF: igual al de PDF (el análisis de 10.000 IFD es barato; el costo es decodificar, ~0,1 a 0,6 s por A4).
5. Las cifras de memoria son de este banco (Windows, 15,7 GB), no de un equipo de 8 GB.

## 2. Tabla por formato (decodificar y armar)
Decodificar = `createImageBitmap` (nativo) o librería, con dibujo en canvas; pico = delta renderer. Armado: sección 6.

| Formato | Soporte | Librería | Decodificar | Pico MB | Comentarios |
|---|---|---|---|---|---|
| PNG A4 300 dpi | nativo | ninguna | 115 ms | 84 | también por `ImageDecoder` (100 ms) |
| JPEG A4 300 dpi | nativo | ninguna | 26 ms | 102 | pasa tal cual si orientación 1 |
| WebP A4 | nativo | ninguna | 51 ms | 67 | animado: primer cuadro |
| GIF A4 150 dpi | nativo | ninguna | 4 ms | 18 | 256 colores |
| BMP 1/4/8/24/32/RLE4/RLE8 (1240x1754) | nativo | ninguna | 6 a 19 ms | 17 a 27 | todos OK |
| TIFF A4 300 dpi | **no** | utif2 | 25 a 556 ms según compresión (G4 556) | 36 a 168 | CMYK pide parche; sin orientación |
| HEIC 12 MP | **no** (ni `nativeImage`) | libheif-js wasm | 958 ms | 137 | primaria explícita |
| HEIC A4 | no | libheif-js wasm | 598 ms | 98 | |
| AVIF | nativo | ninguna | 8 ms (800x533) | 5 | solo registro |

## 3. Versiones y licencias de lo descargado
Todo en `C:\Anonly\spikes\imagenes\vendor\`. Los paquetes npm se instalaron con `--ignore-scripts`; no hay binarios nativos propios (el único binario que se ejecutó, `esbuild`, es el ya instalado en el repo). **No se descargó ni ejecutó ningún instalador ni `.exe`.**

| Cosa | Versión | Licencia | Origen |
|---|---|---|---|
| utif2 | 4.1.0 | MIT | npm |
| pako (de utif2/pdf-lib) | 1.x | MIT AND Zlib | npm |
| libheif-js | 1.23.5 | LGPL-3.0 | npm |
| pdf-lib | 1.17.1 | MIT | npm |
| @cantoo/pdf-lib | 2.11.1 | MIT | npm |
| gifenc | 1.0.3 | MIT | npm |
| pdfjs-dist (del repo, solo lectura) | 4.10.38 | Apache-2.0 | repo |
| esbuild (del repo, solo uso) | 0.25.12 | MIT | repo |
| Muestras libheif `example.heic`, `example.avif` | master | MIT («sample applications», COPYING del repo) | https://github.com/strukturag/libheif/tree/master/examples |
| Nokia HEIF conformance (C001, C002, C003, C006, C007, C008, C013, C014, C022, C025, C034, C039, C040, C042, MIAF007) | master | **sin LICENSE en el repo [NO CONFIRMADO]**; solo para prueba, no redistribuir | https://github.com/nokiatech/heif_conformance |
| Pillow `Tests/images` (hopper_gray.jpg, pil_sample_cmyk.jpg, hopper_g4.tif, hopper_jpg.tif, g4-multi.tiff, hopper_lzw.tif, g4_orientation_6.tif, 16bit.cropped.tif, hopper.tif, avif/hopper.heif) | main | MIT-CMU (HPND) | https://github.com/python-pillow/Pillow |
| libjpeg-turbo `testimages` (testimgari, testimgint, testorig) | main | IJG/BSD/Zlib (`LICENSE.txt` en vendor) | https://github.com/libjpeg-turbo/libjpeg-turbo |
| wuffs `test/data` (peacock.progressive.jpeg, peacock.default.jpeg, bricks-gray.jpeg) | main | Apache-2.0 (repo), imágenes: **[NO CONFIRMADO]** | https://github.com/google/wuffs |

HEIC de 12 MP y 48 MP: codificados aquí con el codificador HEIF de Windows (`gen-heic-winrt.ps1`) desde fotos sintéticas: no son de un tercero. TIFF: WIC de Windows (`gen-tiff-wic.ps1`) más escritores propios (PackBits y JPEG-en-TIFF).

## 4. Casos no cubiertos
- **[NO CONFIRMADO]** HEIC de un iPhone real, 12 MP con `irot` real de cámara y mosaico de 512x512 grande. **[NO CONFIRMADO]** documentos reales (R1...: ninguno).
- No generados: TIFF big-endian, TIFF por tiras múltiples con LZW de scanner real, TIFF tileado, WebP lossless gigante, HEIC bomba, APNG animado.
- El JPEG CMYK no se probó con tinta invertida de Adobe (el de Pillow se vio bien en `pdf.js`).
- Memoria de la ruta con `OffscreenCanvas` en el Worker; otra arquitectura (UI thread) no medida.

## 5. Cómo volver a correrlo
```
# PowerShell: refrescar PATH (node/pnpm); en Git Bash:  . C:/Anonly/spikes/imagenes/harness/env.sh
cd C:\Anonly\spikes\imagenes\harness
# 1) bundles (esbuild del repo, NODE_PATH al vendor)
export NODE_PATH=C:/Anonly/spikes/imagenes/vendor/pkgs/node_modules
./build.sh C:/Anonly/Anonly/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild $NODE_PATH C:/Anonly/spikes/imagenes/harness/dist
cp ../vendor/pkgs/node_modules/gifenc/dist/gifenc.esm.js dist/
# 2) corpus
node run-suite.mjs gen - ../results/gen.json
powershell -File gen-tiff-wic.ps1 -Corpus C:\Anonly\spikes\imagenes\corpus
node run-suite.mjs gen2 - ../results/gen2.json ; node run-suite.mjs gen3 - ../results/gen3.json
node gen-bombs.mjs ../corpus 22000,23000,24000,26000
powershell -File gen-heic-winrt.ps1 -In <jpg> -Out <heic>      # 12 MP y 48 MP
# 3) suites (SPIKE_ELECTRON = electron.exe de node_modules/.pnpm/electron@44.11.5)
node run-suite.mjs caps ../results/args-caps.json ../results/q1-caps.json [--no-worker-csp] [--csp unsafe-eval]
node run-suite.mjs exif - out.json ; anim ; tiff <args> ; heic <args> ; heifcmp ; pdf <args>
node run-suite.mjs nativemain ../results/args-native.json out.json
node run-bombs.mjs <casos.json> out.json
node verify-pdf.mjs <pdfjs-dist-dir> <q6.json> ../results/pdfs <out.json>
```
Las muestras de terceros están en `vendor/` y se copiaron a `corpus/` con prefijo `ext_` y `heic_`. Los argumentos (`args-*.json`) y salidas (`q*.json`) están en `results/`; los PDF generados en `results/pdfs/`.
