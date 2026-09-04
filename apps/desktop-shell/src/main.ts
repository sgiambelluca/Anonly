import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";

import { rendererRoot, resolveAssetPath } from "./paths";
import { headersFor } from "./security";
import { loadBridge } from "./updater";

const SCHEME = "app";
const ORIGIN = `${SCHEME}://local`;

/**
 * De dónde se lee la lista de versiones (ADR-131 §1). Es un asset del último
 * release: no hay servidor ni dominio propio.
 *
 * **La clave pública no está acá y no puede estarlo.** Sparkle no expone un
 * setter de runtime para `SUPublicEDKey`: la lee del `Info.plist`, horneada al
 * empaquetar (`electron-builder.yml`, `mac.extendInfo`). Medido el 2026-09-04:
 * pasarla por `init()` produce `publicEdKey was supplied but Info.plist has no
 * SUPublicEDKey` y el arranque muere con `SUSparkleErrorDomain Code=1`.
 *
 * Y está bien que sea así: en el `Info.plist` la clave queda cubierta por la
 * firma del bundle; como constante en JS viviría adentro del asar, que
 * cualquiera reemplaza sin romper ninguna firma.
 */
const APPCAST_URL = "https://github.com/sgiambelluca/Anonly/releases/latest/download/appcast.xml";

/**
 * `standard` y `secure` no son decorativos (ADR-132 §2, verificado en el
 * spike): sin `standard` el esquema no tiene origen y los module workers no
 * cargan; sin `secure` no es contexto seguro y no hay `SharedArrayBuffer`, o
 * sea que `onnxruntime-web` cae a un hilo.
 *
 * Va antes de `whenReady`: Electron exige registrarlo con el runtime todavía
 * sin arrancar.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function registerProtocol(root: string): void {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = resolveAssetPath(root, pathname);
    if (filePath === null) return new Response("Forbidden", { status: 403 });

    let response: Response;
    try {
      response = await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      // Archivo inexistente: `net.fetch` sobre `file://` tira en vez de dar un
      // status. Sin este catch, el handler rechaza la promesa y el renderer ve
      // un error de red opaco en lugar de un 404.
      return new Response("Not Found", { status: 404, headers: headersFor(pathname) });
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(headersFor(pathname))) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Nada que no sea `app://` se carga adentro de la app: una navegación externa
 * dentro de la ventana correría contenido remoto con el mismo origen que el
 * documento del usuario. Los links legítimos (releases, repo) se delegan al
 * navegador del sistema, que es donde el usuario puede ver a dónde va.
 */
function lockNavigation(window: BrowserWindow): void {
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#ffffff",
    title: "Anonly",
    /*
     * El `preload` expone exactamente tres mensajes salientes y un suscriptor,
     * todos del actualizador (ver `preload.ts`). `contextIsolation` y `sandbox`
     * siguen puestos: el preload corre aislado y no le da al renderer acceso a
     * Node ni a `ipcRenderer` crudo.
     */
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  lockNavigation(window);
  window.once("ready-to-show", () => window.show());
  return window;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const root = rendererRoot({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    shellDir: __dirname,
  });

  registerProtocol(root);
  const window = createWindow();
  await window.loadURL(`${ORIGIN}/index.html`);

  startUpdater(window);

  // En macOS la app sigue viva sin ventanas; el click en el dock la reabre.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createWindow();
      void reopened.loadURL(`${ORIGIN}/index.html`);
    }
  });
}

/**
 * Arranca el actualizador de macOS, o no hace nada.
 *
 * Ninguna falla acá puede impedir que la app abra: Anonly anonimiza documentos
 * sin tocar la red, así que quedarse sin actualizarse solo es mucho menos
 * grave que no arrancar. En Windows no corre —ahí actualiza
 * `electron-updater`— y en macOS sin clave pública tampoco.
 */
function startUpdater(window: BrowserWindow): void {
  const bridge = loadBridge(
    {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      shellDir: __dirname,
    },
    (message) => process.stdout.write(`${message}\n`),
  );
  if (bridge === null) return;

  bridge.setEventHandler((event) => {
    // Solo el ciclo de vida de la actualización: tipo, versión y progreso.
    // Nunca contenido, nombre ni metadato de un documento (ADR-131 §5).
    if (window.isDestroyed()) return;
    window.webContents.send("updater:event", {
      type: event.type,
      ...(event.version === undefined ? {} : { version: event.version }),
      ...(event.percent === undefined ? {} : { percent: event.percent }),
    });
  });

  /*
   * Si no arranca —típicamente porque el `Info.plist` no tiene
   * `SUPublicEDKey`— se anota y se sigue. La app funciona igual: Anonly
   * anonimiza sin tocar la red, así que quedarse sin actualizarse solo es
   * mucho menos grave que no abrir.
   */
  if (!bridge.init({ appcastUrl: APPCAST_URL, publicEdKey: "" })) {
    process.stdout.write("[anonly] actualizador no arrancó (¿falta SUPublicEDKey?)\n");
    return;
  }

  /*
   * **La política vive en el renderer, no acá.** El usuario elige entre que le
   * pregunten o que se instale solo, y ese setting se persiste con los demás
   * en `localStorage`. El main no decide nada: informa lo que Sparkle reporta
   * y ejecuta lo que el renderer le pide.
   *
   * Sparkle chequea igual; lo que cambia es qué pasa cuando encuentra algo.
   */
  bridge.setAutomaticChecks(true);

  ipcMain.on("updater:check", () => bridge.checkForUpdates());
  ipcMain.on("updater:install", () => bridge.installUpdateNow());
  ipcMain.on("updater:set-automatic", (_event, enabled: unknown) => {
    // El renderer es la parte menos confiable de las dos: lo que llega por IPC
    // se valida antes de usarse, aunque hoy lo mande código nuestro.
    if (typeof enabled !== "boolean") return;
    bridge.setAutomaticChecks(enabled);
  });
}

/*
 * Si el arranque falla no hay UI donde mostrarlo —la ventana es justamente lo
 * que no llegó a existir—, así que se reporta por stderr y se sale con código
 * distinto de cero. Tragarlo dejaría un proceso vivo sin ventana, que desde
 * afuera se ve como "la app no abre" y no deja rastro.
 */
bootstrap().catch((error: unknown) => {
  process.stderr.write(`[anonly] fallo al arrancar el shell: ${String(error)}\n`);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
