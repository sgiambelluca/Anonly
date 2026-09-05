/**
 * Aplica el tema elegido al documento.
 *
 * El mecanismo es un atributo en `<html>` y no una clase ni un contexto de
 * React: los tokens de color viven en CSS (`index.css`), así que el tema tiene
 * que resolverse en CSS. Un contexto obligaría a que cada componente lo
 * consuma, y cualquiera que se olvidara quedaría con los colores del tema
 * equivocado.
 *
 * `"system"` **quita** el atributo en vez de escribir un valor calculado. Así
 * la media query de `index.css` sigue mandando, y si el usuario cambia el modo
 * del sistema operativo con la app abierta, la app lo acompaña sola — sin
 * escuchar ningún evento.
 */
import type { Theme } from "./store/settings.store.js";

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    delete document.documentElement.dataset["theme"];
    return;
  }
  document.documentElement.dataset["theme"] = theme;
}
