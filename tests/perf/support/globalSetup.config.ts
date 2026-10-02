/**
 * Entrada de `globalSetup` para `playwright.perf.config.ts`. Playwright exige
 * que el módulo de `globalSetup` tenga `export default` — la lógica en sí
 * vive en `checkFreshBuild.ts` (named export, sin excepción de lint) y este
 * archivo, sufijado `.config.ts` como el resto de los configs del repo, es
 * el único lugar que necesita la excepción de `import/no-default-export`
 * (`eslint.config.js`, patrón de archivo `*.config.{js,ts,mjs,cjs}`).
 */
import { checkFreshBuild } from "./checkFreshBuild.js";

export default checkFreshBuild;
