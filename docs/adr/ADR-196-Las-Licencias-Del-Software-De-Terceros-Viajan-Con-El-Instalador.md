<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-060-Reemplazo-Por-Genero.md,adr/ADR-070-Atribucion-Visible-En-El-Producto.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,roadmap/Future_Ideas.md,roadmap/SignPath_Postulacion.md | audiencia=humanos+IA | fase=12 -->

# ADR-196 — Las licencias del software de terceros viajan con el instalador

- **Estado**: Aceptado.
- **Fecha**: 2026-10-02.
- **Decidido por**: el humano, que pidió cerrar los créditos de licencias
  antes de la 1.0 y de la postulación a SignPath. El planificador eligió la
  forma.
- **Alcance**: `apps/react-client` (build y `AboutDialog`) y `NOTICE`. Sin
  cambio de contrato del Core, sin dependencias nuevas (R-12) y sin URLs
  externas nuevas (ADR-070 §3).
- **Cierra**: la deuda anotada en ADR-070, Contexto §4, y en
  `Future_Ideas.md` §1.6.

## Contexto

ADR-070 resolvió la atribución de **datos** de terceros (el léxico de género,
CC-BY). Dejó anotado, sin resolver, el **código y los modelos** que el
instalador distribuye:

- Las licencias MIT, ISC y BSD piden que el aviso de copyright y el texto de
  la licencia acompañen a toda copia. Apache-2.0 pide además entregar una
  copia de la licencia y propagar el `NOTICE` del proyecto original, si lo
  tiene.
- El bundle de Vite minifica y no conserva esos textos. Hoy el instalador
  lleva `LICENSE.electron.txt` y `LICENSES.chromium.html`, que pone
  `electron-builder`, y nada del resto.
- Lo que viaja no es solo lo que figura en los `package.json`. También viajan
  las dependencias transitivas que el bundle incluye, los assets espejados de
  `assets.lock.json` (ADR-018: Tesseract, sus datos de idioma, ONNX Runtime y
  el modelo de NER), y las fuentes y cMaps de pdf.js (ADR-053).

## Decisión

### 1. Un archivo con los textos completos, generado en el build

El build de `apps/react-client` genera
`licenses/THIRD_PARTY_LICENSES.txt` dentro de su `dist`. Por
`extraResources`, el archivo queda en el instalador en
`resources/renderer/licenses/`, sin tocar `electron-builder.yml`.

No se commitea: es un producto del build, como los assets de pdf.js
(`public/pdfjs/`).

Por cada componente lleva nombre, versión, licencia y el texto completo de su
archivo de licencia. Si el paquete trae un archivo `NOTICE`, también va
completo.

### 2. De dónde sale la lista

De tres fuentes, y las tres son obligatorias:

1. **Lo que el bundle incluye de verdad.** Un plugin propio de Vite, en
   `apps/react-client`, registra el paquete de `node_modules` de cada módulo
   que entra al bundle principal **y a los bundles de los workers**. No se
   usa el árbol de dependencias declarado: incluye paquetes que no viajan
   (por ejemplo, los binarios nativos opcionales de `@huggingface/transformers`).
2. **Las dependencias de producción del contenedor.** El cierre transitivo de
   `dependencies` de `apps/desktop-shell/package.json`, que `electron-builder`
   empaqueta en el `asar`.
3. **Lo que no pasa por el bundle.** Una tabla escrita a mano, en el mismo
   módulo del plugin, con una entrada por familia:

   | Familia | Qué cubre | Licencia |
   |---|---|---|
   | `tesseract-worker` | `tesseract.js` | Apache-2.0 |
   | `tesseract-core*` | `tesseract.js-core` (Tesseract y Leptonica compilados) | Apache-2.0 |
   | `tesseract-lang-*` | datos de idioma `tessdata` | Apache-2.0 |
   | `ner-model-*` | `Davlan/bert-base-multilingual-cased-ner-hrl`, en su conversión ONNX de `Xenova` | AFL-3.0 |
   | `onnxruntime-*` | `onnxruntime-web` | MIT |
   | pdf.js: cMaps y fuentes estándar | los `LICENSE*` que `pdfjs-dist` trae en `cmaps/` y `standard_fonts/` | BSD-3-Clause y SIL OFL 1.1 |
   | Sparkle (solo macOS) | el framework vendoreado del actualizador | MIT, con sus avisos de terceros |

   El texto de cada licencia se toma del paquete instalado cuando existe. Los
   que no tienen paquete (AFL-3.0, Sparkle) se commitean como archivo de
   texto en `apps/react-client`, tomados de su fuente oficial y sin editar.
   Los datos de idioma de Tesseract no tienen paquete instalado: llevan el
   texto Apache-2.0 de `tesseract.js-core`, con una nota que lo dice.

### 2bis. Textos de respaldo

Algunos paquetes declaran su licencia en `package.json` y no traen el archivo
(medido el 2026-10-02: `onnxruntime-web`, `onnxruntime-common`,
`react-remove-scroll-bar` y `lazy-val`; este último es el caso de §2ter). Para esos hay una tabla explícita
`paquete@versión → archivo commiteado`, en el módulo del plugin:

- El texto se toma del repositorio oficial del paquete, en la versión o el
  commit que corresponde, sin editar.
- La tabla fija la versión. Si la versión instalada cambia, el build falla
  hasta que alguien revise el texto y actualice la fila.
- `licenses/SOURCES.txt` registra, por archivo commiteado, la URL, el commit
  completo (no una rama) y el sha256 del archivo.
- Excepción aceptada: el `LICENSE` de `react-remove-scroll-bar` se toma del
  commit que lo agregó al repositorio, posterior a la versión 2.3.8
  instalada, porque esa versión se publicó sin el archivo.
- Para ONNX Runtime se commitean dos archivos del repositorio
  `microsoft/onnxruntime`: `LICENSE` y `ThirdPartyNotices.txt`. El segundo
  cubre el código de terceros que `onnxruntime-web` trae ya compilado dentro
  de su `dist`, y que por eso no aparece como módulo del bundle.

### 2ter. Licencia declarada sin texto publicado

`lazy-val@1.0.5` (dependencia de `electron-updater`) declara `MIT` en su
`package.json` y su proyecto no publica ningún texto de licencia: ni en el
paquete ni en el repositorio. No hay texto oficial que copiar, y no se
inventa un aviso de copyright.

Para ese caso la tabla de respaldo admite una fila de otro tipo, también
fijada por versión. La entrada del archivo generado dice, sin más:

- la licencia declarada, el autor y el repositorio, tal como figuran en el
  `package.json` del paquete;
- que el proyecto no publica un texto de licencia propio;
- el texto estándar de esa licencia según SPDX, rotulado como texto
  estándar y con sus campos de año y titular **sin completar**.

El texto estándar se commitea tomado de `spdx/license-list-data`, sin editar.
Una fila de este tipo es una excepción que decide el planificador, una por
paquete.

### 2quater. Código de terceros compilado dentro de otro paquete

Un paquete que llega **ya compilado dentro del `dist` de otro** no aparece
como módulo del bundle, y §2.1 no lo ve. Lo encontró el revisor el 2026-10-02:

- `@huggingface/transformers` trae adentro `@huggingface/jinja` (MIT) y
  `@huggingface/tokenizers` (Apache-2.0);
- el `worker.min.js` de `tesseract.js` trae `buffer`, `ieee754`,
  `regenerator-runtime` y `zlib.js`, que declara en su
  `worker.min.js.LICENSE.txt`;
- ONNX Runtime, ya cubierto por su `ThirdPartyNotices.txt` (§2bis).

Se cubre con dos mecanismos, y los dos son obligatorios:

1. **Avisos que el propio artefacto trae.** Por cada artefacto precompilado
   que el instalador distribuye —los `dist` de paquetes que entran al bundle
   ya minificados y los assets de `assets.lock.json`—, si el paquete trae un
   archivo de avisos junto al artefacto (`*.LICENSE.txt`, `ThirdPartyNotices*`
   o equivalente), va completo en la entrada de ese componente.
2. **Tabla de embebidos.** Una tabla explícita `paquete anfitrión@versión →
   paquetes embebidos`, en el módulo del plugin. Cada embebido es una entrada
   propia del archivo, con el texto de licencia de su paquete instalado, o de
   la tabla de respaldo si no está instalado. La tabla fija la versión del
   anfitrión: si cambia, el build falla hasta que alguien revise qué trae
   adentro la versión nueva.

La tabla se arma auditando cada artefacto precompilado, uno por uno:
`transformers.web.js`, el worker y los núcleos de Tesseract, los workers de
pdf.js y los archivos de ONNX Runtime. El resultado de esa auditoría —qué se
miró y qué se encontró en cada uno— queda escrito junto a la tabla.

Las versiones de los embebidos no se pueden leer del artefacto minificado: se
asume la versión instalada o, si el paquete no está instalado, la que declara
el anfitrión. La entrada de cada embebido lo dice.

**Límite conocido.** Esto depende de una auditoría manual por versión. Un
embebido que el anfitrión no declara y que la auditoría no ve queda sin
acreditar. La versión fijada obliga a repetirla en cada actualización.

### 2quinquies. Límite aceptado: las librerías nativas dentro de `tesseract.js-core`

La auditoría del 2026-10-02 (`apps/react-client/licenses/AUDITORIA-EMBEBIDOS.txt`)
encontró que los `.wasm` de `tesseract.js-core@6.1.2` llevan compiladas, además
de Tesseract, otras librerías: sus cadenas nombran Leptonica, libjpeg, libtiff
y libwebp. El paquete solo trae su `LICENSE`
Apache-2.0 y no publica avisos de terceros. Desde el binario no se pueden
leer versiones ni licencias, y no se afirman.

Lo que se hace hoy: la entrada de `tesseract.js-core` lleva una nota que dice
exactamente eso —qué librerías se observaron, que su proyecto no publica sus
avisos y que no se pudieron verificar—. **No se agregan textos de licencia
que nadie pudo confirmar.**

**Aceptado por el humano como límite conocido (2026-10-02)**: no hace falta
ir tan atrás. La alternativa descartada era reconstruir esa lista desde los
scripts de compilación de `tesseract.js-core`, que fijan qué versiones
enlaza. Si alguna vez se retoma: una de esas librerías, libjpeg, suele
distribuirse bajo la licencia IJG, que no está en la lista admitida de §3.

### 3. El build falla antes que publicar una lista incompleta

El build termina con error, sin generar el archivo, en cualquiera de estos
casos:

- un paquete del bundle o del contenedor no tiene archivo de licencia ni
  texto de respaldo;
- un paquete sin archivo de licencia no tiene fila en la tabla de respaldo
  (§2bis), o la tiene para otra versión;
- un archivo de licencia está vacío;
- un anfitrión de la tabla de embebidos (§2quater) está instalado en otra
  versión que la que la tabla fija;
- su licencia declarada no está en la lista admitida: `MIT`, `ISC`,
  `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `0BSD`, `Zlib`,
  `BlueOak-1.0.0`, `Python-2.0`. Una expresión con `AND` se admite si todos
  sus términos están en la lista; con `OR`, si alguno lo está;
- un `id` de `assets.lock.json` no corresponde a ninguna familia de la tabla
  de §2.3.

Una licencia fuera de la lista no se agrega desde la implementación: es una
decisión del planificador, igual que una dependencia nueva (R-12).

### 4. Qué muestra el producto

`AboutDialog` suma una sección **«Software de terceros»**, debajo de «Datos
de terceros»:

- Una lista compacta, de solo lectura: nombre del componente, para qué se usa
  y licencia. Una fila por componente **principal**: React, Radix UI, Lucide,
  Zustand, pdf.js, pdf-lib, Tesseract (motor y datos de idioma),
  Transformers.js, ONNX Runtime, el modelo de NER, Electron,
  `electron-updater` y Sparkle (solo macOS). Tesseract ocupa dos filas, como
  en `NOTICE`: el motor y los datos de idioma.
- Una oración al pie: los textos completos de todas las licencias, incluidas
  las de las dependencias internas, viajan con la aplicación instalada, en
  `resources/renderer/licenses/THIRD_PARTY_LICENSES.txt` (en macOS, dentro de
  `Anonly.app/Contents/Resources/`).

La lista es un módulo de datos propio, `thirdPartySoftware.ts`, junto a
`thirdPartyCredits.ts` (ADR-070 §2: los créditos son datos, no JSX). No se
reutiliza `ThirdPartyCredit`: sus campos `changes` y `holder` son exigencias
de CC-BY y no aplican.

**Sin enlaces.** La sección no agrega ninguna URL externa navegable: la lista
de ADR-070 §3 no cambia.

### 5. `NOTICE`

`NOTICE` suma una sección «Software y modelos de terceros» con la misma lista
de componentes principales y una referencia al archivo generado. Es lo que ve
quien mira el repositorio sin instalar la app.

### 6. Cómo se verifica

- Tests del plugin, sin correr un build completo: extracción del paquete
  desde un id de módulo (incluidos los paquetes con scope y las rutas de
  pnpm), todos los casos de falla de §3, y que cada `id` del
  `assets.lock.json` real cae en una familia.
- Test de sincronización: cada componente de `thirdPartySoftware.ts` aparece
  en `NOTICE`, con la misma licencia. Es el mismo criterio que ADR-070 §5.
- Una comprobación sobre el `dist` ya construido: el archivo existe, no está
  vacío y nombra a cada componente principal.

## Licencias admitidas el 2026-10-02

`Zlib` (`pako`, dentro de pdf-lib), `BlueOak-1.0.0` (`sax`) y `Python-2.0`
(`argparse`, por `js-yaml`) entraron a la lista al medir el bundle real. Las
tres son permisivas: piden conservar el aviso y el texto, que es lo que el
archivo generado hace.

## Lo que no se hace

- **Un visor de licencias dentro de la app.** El archivo en la carpeta de
  instalación cumple la obligación, igual que los dos que ya pone
  `electron-builder`. Si se quiere un visor, es una función nueva.
- **Auditar las licencias de las herramientas de desarrollo.** No se
  distribuyen.

## Consecuencias

- Agregar una dependencia que entra al bundle ya no pide tocar ninguna lista:
  el archivo se regenera. Agregar un asset espejado sí pide una fila en la
  tabla, y el build lo exige.
- El build de `apps/react-client` puede fallar por una licencia. Es
  deliberado.
- La conversión ONNX de `Xenova` no declara licencia propia y hereda la del
  modelo original (`SignPath_Postulacion.md` §1). Se acredita así, con las dos
  procedencias.
