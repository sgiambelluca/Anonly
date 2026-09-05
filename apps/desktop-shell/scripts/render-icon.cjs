/**
 * Rasteriza `assets/icon.svg` a `assets/icon.png` (1024×1024), que es lo que
 * consume `electron-builder` para generar el `.icns` de macOS y el `.ico` de
 * Windows.
 *
 * Corre con Electron y no con una librería de imágenes porque el repo no tiene
 * ninguna —ni ImageMagick ni Pillow están disponibles— y Electron ya es
 * dependencia del shell: agregar un rasterizador solo para esto sería una
 * dependencia nueva (R-12) por un archivo que cambia una vez por año.
 *
 *   pnpm --filter @anonly/desktop-shell icon
 *
 * El PNG se commitea igual: el build de release no puede depender de levantar
 * un Chromium headless, y así el instalador se arma en CI sin este paso.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const ASSETS = path.resolve(__dirname, "..", "assets");
const SIZE = 1024;

app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    const svg = fs.readFileSync(path.join(ASSETS, "icon.svg"), "utf8");
    const window = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: { offscreen: true },
    });

    const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    // El SVG tiene un gradiente y un filtro de sombra: capturar antes de que
    // termine de componer produce un PNG con la sombra a medio dibujar.
    await new Promise((resolve) => setTimeout(resolve, 900));

    /*
     * `capturePage` devuelve la captura en píxeles físicos: en una pantalla
     * Retina son 2048, en una normal 1024. Sin este `resize` el archivo saldría
     * distinto según la máquina que corra el script — y en CI, distinto del
     * commiteado. El tamaño lo fija el código, no el monitor.
     */
    const image = (await window.webContents.capturePage()).resize({ width: SIZE, height: SIZE });
    fs.writeFileSync(path.join(ASSETS, "icon.png"), image.toPNG());
    process.stdout.write(`icon.png escrito (${SIZE}×${SIZE})\n`);
    app.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`render-icon: ${String(error)}\n`);
    app.exit(1);
  });
