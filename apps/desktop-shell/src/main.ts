import { pathToFileURL } from "node:url";

import { app, BrowserWindow, net, protocol, shell } from "electron";

import { rendererRoot, resolveAssetPath } from "./paths";
import { headersFor } from "./security";

const SCHEME = "app";
const ORIGIN = `${SCHEME}://local`;

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
     * Sin `preload`: la superficie main↔renderer es **cero** (ADR-132 §3).
     * Hubo uno, que existía solo para avisarle al renderer que corría en el
     * contenedor; cuando ADR-132 §7 se resolvió apagando la caché en el motor
     * —donde vive de verdad—, ese aviso se quedó sin nadie que lo leyera. Un
     * preload que expone un booleano que nadie consume no es superficie
     * mínima: es superficie muerta que además miente sobre que el renderer se
     * bifurca por plataforma.
     *
     * `contextIsolation` y `sandbox` no dependen del preload: son opciones de
     * la ventana y siguen puestas.
     *
     * El primer canal real lo va a traer el actualizador (ADR-131) para avisar
     * que hay versión nueva. Se diseña ahí, con su justificación.
     */
    webPreferences: {
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

  // En macOS la app sigue viva sin ventanas; el click en el dock la reabre.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createWindow();
      void reopened.loadURL(`${ORIGIN}/index.html`);
    }
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
