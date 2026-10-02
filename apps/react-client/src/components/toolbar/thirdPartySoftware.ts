/**
 * `thirdPartySoftware.ts` — software y modelos de terceros que distribuye el
 * instalador, como datos (no JSX) para `AboutDialog` (ADR-196 §4,
 * `ui/Components.md` §2.9).
 *
 * Una fila por componente **principal**; los textos completos de todas las
 * licencias, incluidas las de las dependencias internas, van en
 * `THIRD_PARTY_LICENSES.txt` (ADR-196 §1). No reutiliza `ThirdPartyCredit`:
 * `changes` y `holder` son exigencias de CC-BY y acá no aplican, y la lista no
 * lleva enlaces (ADR-070 §3 sigue valiendo).
 *
 * `__tests__/third-party-software.test.ts` ata cada fila a `NOTICE` (ADR-196
 * §6): nombre y licencia tienen que coincidir.
 */

export interface ThirdPartySoftware {
  readonly id: string;
  /** Nombre como aparece al principio de su línea en `NOTICE`. */
  readonly name: string;
  /** Para qué lo usa Anonly, en una línea. */
  readonly usedFor: string;
  /** Licencia, tal cual figura en `NOTICE` (identificador SPDX). */
  readonly license: string;
}

/** Dónde queda el archivo con los textos completos, dentro de la aplicación instalada. */
export const THIRD_PARTY_LICENSES_PATH = "resources/renderer/licenses/THIRD_PARTY_LICENSES.txt";

/** En macOS la carpeta `resources` está dentro del paquete `.app` (ADR-196 §4). */
export const THIRD_PARTY_LICENSES_MAC_DIR = "Anonly.app/Contents/Resources/";

export const THIRD_PARTY_SOFTWARE: ReadonlyArray<ThirdPartySoftware> = [
  { id: "react", name: "React", usedFor: "Interfaz de la aplicación.", license: "MIT" },
  {
    id: "radix-ui",
    name: "Radix UI",
    usedFor: "Diálogos, menús y controles accesibles.",
    license: "MIT",
  },
  { id: "lucide", name: "Lucide", usedFor: "Iconos de la interfaz.", license: "ISC" },
  { id: "zustand", name: "Zustand", usedFor: "Estado de la interfaz.", license: "MIT" },
  { id: "pdfjs", name: "pdf.js", usedFor: "Leer y mostrar los PDF.", license: "Apache-2.0" },
  { id: "pdf-lib", name: "pdf-lib", usedFor: "Escribir el PDF anonimizado.", license: "MIT" },
  {
    id: "tesseract",
    name: "Tesseract",
    usedFor: "Reconocer el texto de los documentos escaneados (motor).",
    license: "Apache-2.0",
  },
  {
    id: "tesseract-data",
    name: "Datos de idioma de Tesseract",
    usedFor: "Idiomas que el OCR sabe leer (español, inglés y orientación de página).",
    license: "Apache-2.0",
  },
  {
    id: "transformers-js",
    name: "Transformers.js",
    usedFor: "Ejecutar el modelo que detecta nombres y organizaciones.",
    license: "Apache-2.0",
  },
  {
    id: "onnx-runtime",
    name: "ONNX Runtime",
    usedFor: "Motor de inferencia del modelo de detección.",
    license: "MIT",
  },
  {
    id: "ner-model",
    name: "Modelo de NER",
    usedFor: "Detectar nombres y organizaciones (bert-base-multilingual-cased-ner-hrl, Davlan).",
    license: "AFL-3.0",
  },
  { id: "electron", name: "Electron", usedFor: "Contenedor de escritorio.", license: "MIT" },
  {
    id: "electron-updater",
    name: "electron-updater",
    usedFor: "Buscar e instalar actualizaciones.",
    license: "MIT",
  },
  {
    id: "sparkle",
    name: "Sparkle (solo macOS)",
    usedFor: "Actualizador de la versión para macOS.",
    license: "MIT",
  },
];
