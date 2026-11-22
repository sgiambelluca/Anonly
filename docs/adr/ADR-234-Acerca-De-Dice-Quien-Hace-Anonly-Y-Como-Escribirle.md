<!-- CONTEXT: scope=adr | dependencias=adr/ADR-070-Atribucion-Visible-En-El-Producto.md,adr/ADR-168-Pantallas-De-Carga-Y-Escaneo-Tras-Pruebas-De-Usuario.md,adr/ADR-169-La-Pantalla-De-Trabajo-Tras-Pruebas-De-Usuario.md,ui/Components.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-234 — «Acerca de» dice quién hace Anonly y cómo escribirle

- **Estado**: Aceptado por el mantenedor el 2026-11-22. El contenido y la
  dirección de correo son decisión suya; los detalles técnicos (§3 y §4) son
  del planificador.
- **Fecha**: 2026-11-22.
- **Decidido por**: el mantenedor, sobre el lienzo de diseño «Anonly — Acerca
  de» (opción A, tarjeta del desarrollador).
- **Extiende**: ADR-168 §3 (contenido de `AboutDialog` y lista de URLs
  externas) y, por esa vía, la regla de ADR-070 §3.
- **Alcance**: `react-client` (`AboutDialog`, `externalLinks.ts`) y
  `desktop-shell` (`setWindowOpenHandler`). Sin cambio de contrato, sin Core,
  sin dependencias nuevas.

## Contexto

`AboutDialog` dice qué es Anonly, dónde está el código y qué datos y software
de terceros usa, pero no dice quién lo hace. La única vía de contacto es
«Reportar un problema», que lleva a GitHub y pide una cuenta. Esa vía sirve para
un error, pero no para alguien que quiere contar cómo usa la herramienta o
proponer una idea.

Además, el shell de Electron abre afuera solo las URLs `https://`
(`main.ts`, `setWindowOpenHandler`) y bloquea cualquier navegación fuera de
`app://` (`will-navigate`). Un enlace `mailto:` hoy no hace nada.

## Decisión

### 1. Una sección «Quién lo hace» en `AboutDialog`

Va después del párrafo de presentación y antes de «Código fuente». Es una
tarjeta con el mismo estilo de las demás del diálogo (borde, `bg-secondary`,
`rounded-xl`), con:

- las iniciales del mantenedor en un círculo de acento (decorativo,
  `aria-hidden`);
- el nombre, y debajo el rol y la ciudad;
- un texto breve que invita a escribir con ideas y experiencias de uso;
- dos acciones y la dirección visible (§2).

Es contenido estático: no aparece ni desaparece nada, y no mueve el diseño
(ADR-169 §1).

El diálogo pierde la bajada «Versión … · Licencia MIT» debajo del título: las
dos cosas ya están en el pie de la pantalla de carga, a la vista detrás del
diálogo (ADR-168 §1, ADR-216).

### 2. Dos acciones: escribir y copiar el correo

- **«Escribirme por mail»** (acción principal): `<a href="mailto:…">` con un
  asunto que lleva la versión (`Anonly <versión>: idea o comentario`). Lo abre
  el usuario, y el sistema operativo lo pasa a su programa de correo.
- **«Copiar correo»** (secundaria): copia la dirección al portapapeles con
  `navigator.clipboard.writeText`. Cubre al usuario que no tiene un programa de
  correo configurado (en Windows, el caso común de quien usa el correo web):
  ahí el `mailto:` no hace nada visible. Al copiar, el botón dice «Copiado»
  durante 2 segundos. El ancho del botón no cambia entre los dos rótulos.
- La dirección queda **visible y seleccionable** en texto monoespaciado, para
  quien prefiera copiarla a mano.

### 3. Una dirección de correo nueva, bajo la regla de ADR-070 §3

La tabla de ADR-168 §3 gana una fila:

| URL | Dónde |
|---|---|
| `mailto:santinogiambe@gmail.com` | `AboutDialog`, «Quién lo hace» |

Vive en `externalLinks.ts` como `CONTACT_EMAIL`, junto con las demás. Mismo
razonamiento que ADR-070 §3: es un enlace fijo y commiteado que abre **el
usuario**, no un request de la app; `connect-src 'self'` sigue sin
excepciones. Copiar al portapapeles tampoco es una salida de red.

### 4. El shell deja pasar `mailto:` al sistema

`setWindowOpenHandler` pasa a abrir con `shell.openExternal` las URLs
`https://` **y** `mailto:`. Todo lo demás se sigue denegando, y `will-navigate`
no cambia. El enlace lleva `target="_blank"`, como los otros externos, así que
entra por `setWindowOpenHandler` y no por `will-navigate`.

## Consecuencias

**A favor**

- Quien quiera aportar una idea tiene una vía directa, sin cuenta de GitHub.
- «Copiar correo» evita el botón que no hace nada en equipos sin programa de
  correo.

**En contra**

- La dirección personal del mantenedor queda pública, en el repositorio y en
  la app. Lo aceptó el mantenedor al pedirlo.
- El shell abre una clase más de URL. El riesgo es acotado: el renderer solo
  carga el bundle propio (`app://`, CSP), y un `mailto:` solo abre un borrador
  de correo, que el usuario tiene que enviar.

**Lo que no toca**

- `Contracts.md`, el Core y los motores.
- Los créditos y su verificación (ADR-070 §2, §4 y §5; ADR-196 §4 y §6).

## Documentación que cambia

- `ui/Components.md` §2.9: `AboutDialog` y la lista de URLs externas.
- `adr/ADR-168`: nota de extensión en el estado.
