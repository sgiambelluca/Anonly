/**
 * Smoke test del instalador ya empaquetado.
 *
 * Arranca el binario **empaquetado** (no `electron .`), le pide a Chromium la
 * lista de targets por el puerto de depuración, y verifica que haya una página
 * servida por `app://` con el título de la app. O sea: que el protocolo propio
 * quedó registrado, que el `dist` del renderer viajó adentro del paquete y que
 * `rendererRoot()` lo encontró donde `extraResources` lo dejó.
 *
 * **Existe por Windows.** El empaquetado de Windows se produce desde macOS,
 * donde el `.exe` no se puede ejecutar: sin este test corriendo en un runner
 * de Windows, esa plataforma se publicaría sin que nadie la haya visto abrir
 * una sola vez. En macOS también corre, y ahí es barato.
 *
 * No prueba el pipeline —eso son los E2E—: prueba que la app arranca y sirve
 * su propio origen, que es la clase de fallo que un instalador roto produce.
 *
 *   node scripts/smoke.cjs
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RELEASE = path.resolve(__dirname, "..", "release");
const PORT = 9222;
const TIMEOUT_MS = 90_000;
const EXPECTED_ORIGIN = "app://local";

/** @returns {string} Ruta al ejecutable empaquetado para esta plataforma. */
function packagedBinary() {
  const candidates =
    process.platform === "darwin"
      ? [
          // `macos-latest` es arm64; el directorio sin sufijo es el build x64.
          path.join(RELEASE, "mac-arm64", "Anonly.app", "Contents", "MacOS", "Anonly"),
          path.join(RELEASE, "mac", "Anonly.app", "Contents", "MacOS", "Anonly"),
        ]
      : [path.join(RELEASE, "win-unpacked", "Anonly.exe")];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found === undefined) {
    throw new Error(`No hay binario empaquetado. Buscado en:\n  ${candidates.join("\n  ")}`);
  }
  return found;
}

/**
 * Busca la página de la app entre los targets que reporta Chromium.
 *
 * El JSON del endpoint de depuración llega como `any`; se pasa por `unknown` y
 * se valida campo por campo en vez de afirmar su forma con una anotación. Es
 * más largo, pero un smoke test que confía en la forma de lo que recibe puede
 * dar verde sobre una respuesta que no es la que cree.
 *
 * @returns {Promise<{ url: string, title: string } | undefined>}
 */
async function findAppPage() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`);

  /** @type {unknown} */
  const payload = await response.json();
  if (!Array.isArray(payload)) return undefined;

  // `Array.isArray` sobre un `unknown` lo estrecha a `any[]`, así que sin este
  // cast cada elemento vuelve a ser `any` y la validación de abajo no valida
  // nada a ojos del type-checker.
  for (const entry of /** @type {unknown[]} */ (payload)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { url, title, type } = /** @type {Record<string, unknown>} */ (entry);
    if (type === "page" && typeof url === "string" && url.startsWith(EXPECTED_ORIGIN)) {
      return { url, title: typeof title === "string" ? title : "" };
    }
  }
  return undefined;
}

async function main() {
  const binary = packagedBinary();
  process.stdout.write(`smoke: arrancando ${binary}\n`);

  const child = spawn(binary, [`--remote-debugging-port=${PORT}`], { stdio: "pipe" });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  child.on("error", (error) => {
    process.stderr.write(`smoke: no se pudo lanzar el binario: ${String(error)}\n`);
    process.exit(1);
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let page;

  while (Date.now() < deadline && page === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (child.exitCode !== null) {
      process.stderr.write(`smoke: el proceso murió con código ${child.exitCode}\n`);
      process.stderr.write(stderr.join(""));
      process.exit(1);
    }
    try {
      page = await findAppPage();
    } catch {
      // El puerto todavía no escucha: es lo normal durante el arranque.
    }
  }

  child.kill();

  if (page === undefined) {
    process.stderr.write(
      `smoke: no apareció ninguna página en ${EXPECTED_ORIGIN} en ${TIMEOUT_MS} ms\n`,
    );
    process.stderr.write(stderr.join(""));
    process.exit(1);
  }

  process.stdout.write(`smoke: OK — ${page.url} — "${page.title}"\n`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`smoke: ${String(error)}\n`);
  process.exit(1);
});
