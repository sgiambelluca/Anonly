/**
 * Firma ad-hoc del bundle de macOS, en `afterPack`.
 *
 * **No es opcional, y no alcanza con lo que hace el linker.** Un binario arm64
 * sale de la cadena de compilación con una firma ad-hoc *linker-signed*: sirve
 * para que el proceso arranque, pero no sella los recursos del bundle. Medido
 * sobre el build del 2026-09-04, `codesign --verify` sobre esa firma dice:
 *
 *     code has no resources but signature indicates they must be present
 *
 * O sea: firma **inválida**. Y una app descargada (con `com.apple.quarantine`)
 * cuya firma no valida es la que produce «"Anonly" está dañado y no se puede
 * abrir. Deberías moverlo a la Papelera» — el cartel sin escapatoria, que solo
 * se resuelve con un comando de terminal.
 *
 * Con el bundle firmado ad-hoc de verdad, la firma valida y la app cae en el
 * camino de «desarrollador no identificado», que sí tiene el botón "Abrir
 * igualmente". La diferencia para el usuario es entre un trámite de cuatro
 * clics y una pared.
 *
 * Esto NO reemplaza a la notarización (ADR-131 §4): sigue sin haber
 * certificado de Apple y sigue apareciendo la advertencia. Lo que evita es que
 * la advertencia sea la insalvable.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

/**
 * El contexto que pasa `electron-builder`, acotado a lo que este hook usa.
 * Va como JSDoc y no como import de tipos porque `electron-builder` no expone
 * este tipo por un subpath estable, y traerlo entero para tres campos ataría
 * el hook a la forma interna de la herramienta.
 *
 * @typedef {{
 *   electronPlatformName: string,
 *   appOutDir: string,
 *   packager: { appInfo: { productFilename: string } },
 * }} AfterPackContext
 */

/** @param {AfterPackContext} context */
exports.default = function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // `--deep` está desaconsejado para firmas reales (Apple pide firmar de
  // adentro hacia afuera), pero para ad-hoc es la forma soportada de sellar
  // el bundle entero de una: no hay identidad ni entitlements que propagar.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });

  // Falla ruidosamente si quedó inválida: un instalador que no abre en la
  // máquina del usuario no se puede descubrir en el release.
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
