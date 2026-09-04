import { contextBridge } from "electron";

/**
 * Superficie main↔renderer, completa (ADR-132 §3).
 *
 * Un booleano. Sin IPC, sin capacidades, sin datos: lo único que el renderer
 * necesita saber es que corre dentro del contenedor, para apagar la caché de
 * assets (ADR-132 §7) — `Cache Storage` rechaza el esquema `app://`, y
 * cachear archivos que ya son locales no aporta nada.
 *
 * Cualquier cosa que se agregue acá amplía la superficie de ataque del
 * renderer y necesita justificarse contra ADR-132, no contra la comodidad.
 */
contextBridge.exposeInMainWorld("anonlyShell", Object.freeze({ isDesktop: true }));
