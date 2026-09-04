import { join, normalize, resolve, sep } from "node:path";

/**
 * Traduce el pathname de una URL `app://` a una ruta de archivo dentro de la
 * raíz servida, o `null` si la request no es una petición de asset legítima.
 *
 * **Los `..` se rechazan, no se normalizan.** `normalize()` sola ya impide la
 * fuga —colapsa los `..` que sobran contra la raíz, así que `/../../etc/passwd`
 * termina en `<raíz>/etc/passwd`— pero eso convierte un intento de traversal
 * en un 404 silencioso. Un pathname con `..` no es un asset del build: es una
 * sonda, y devolver 403 la deja visible en vez de disolverla.
 *
 * El `decodeURIComponent` va **antes** de mirar los segmentos: `%2e%2e%2f` es
 * `../` una vez decodificado, y chequear primero lo dejaría pasar entero.
 *
 * La comparación final es contra `raíz + sep`, no `startsWith(raíz)` pelado:
 * ese deja pasar un hermano con prefijo común —con raíz `/app/dist`, la ruta
 * `/app/dist-privado/x` empieza con la raíz y está afuera—. Hoy ningún
 * pathname puede producir ese caso (los `..` ya se rechazaron arriba), así
 * que es defensa en profundidad: sostiene la invariante si el filtro de
 * arriba cambia.
 */
export function resolveAssetPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // `%` suelto o secuencia inválida: no es una ruta que este protocolo sirva.
    return null;
  }

  // Un byte NUL trunca la ruta en las syscalls de algunos runtimes.
  if (decoded.includes("\0")) return null;

  // `\` también separa en Windows: un `..\` tiene que caer por la misma puerta.
  if (decoded.split(/[/\\]/).includes("..")) return null;

  const rootAbs = resolve(root);
  const relative = decoded === "/" || decoded === "" ? "/index.html" : decoded;
  const candidate = resolve(join(rootAbs, normalize(relative)));

  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + sep)) return null;
  return candidate;
}

/**
 * Dónde vive el build del renderer.
 *
 * Empaquetada, la app lleva el `dist` de `@anonly/react-client` como recurso
 * (no adentro del asar: los ~202 MB de modelos y wasm se leen mejor desde el
 * filesystem plano, y el asar no aporta nada sobre bytes que ya son públicos).
 * En desarrollo se toma del workspace.
 */
export function rendererRoot(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly shellDir: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "renderer")
    : resolve(options.shellDir, "..", "..", "react-client", "dist");
}
