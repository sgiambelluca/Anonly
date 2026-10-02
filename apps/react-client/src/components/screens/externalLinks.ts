/**
 * `externalLinks.ts` — las URLs del proyecto que el producto enlaza
 * (ADR-070 §3, extendido por ADR-168 §3).
 *
 * Con las dos del crédito de datos (`thirdPartyCredits.ts`: `sourceUrl` y
 * `licenseUrl`) son **las cuatro únicas URLs externas navegables** del
 * producto. Son `<a href>` fijos, `target="_blank" rel="noopener noreferrer"`,
 * que abre **el usuario**: no son requests de la app, y `connect-src 'self'`
 * sigue sin excepciones. Cualquier enlace nuevo necesita su propio ADR.
 *
 * Hasta ADR-168 estas dos vivían en `SettingsDialog` sin ADR que las cubriera;
 * ADR-168 §3 las regulariza al mudarlas al pie de la pantalla de carga y a
 * `AboutDialog`.
 */

/** Código fuente (`AboutDialog`). */
export const REPOSITORY_URL = "https://github.com/sgiambelluca/Anonly";

/** "Reportar un problema" (pie de `LoadScreen` y `AboutDialog`). */
export const REPORT_ISSUE_URL = "https://github.com/sgiambelluca/Anonly/issues/new";

/** Nombre del repositorio tal como se muestra. */
export const REPOSITORY_LABEL = "sgiambelluca/Anonly";

/** Licencia del producto (`LICENSE` en la raíz del repo). */
export const PRODUCT_LICENSE = "MIT";
