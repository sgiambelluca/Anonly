# `native/` — puente a Sparkle (vendoreado)

Addon N-API que expone [Sparkle](https://sparkle-project.org/) —el framework
de actualización estándar de macOS— al proceso main de Electron. Es lo que
permite auto-update en macOS **sin certificado de Apple**: Sparkle valida las
actualizaciones con una clave EdDSA propia en vez de con la firma de Apple,
mientras que el actualizador que Electron trae de fábrica (Squirrel.Mac) exige
una identidad de Developer ID (ADR-131 §3).

## Procedencia

| | |
|---|---|
| Origen | https://github.com/Innei/electron-sparkle-updater |
| Commit | `5b71644e65427843f67b185460cd7d02b2787857` (2026-08-30) |
| Licencia | MIT — copia en `LICENSE.upstream` |
| Sparkle | 2.9.4, sha256 pinneado en `scripts/fetch-sparkle.sh` |

## Por qué vendoreado y no como dependencia

Al evaluarlo (2026-09-04) el paquete tenía mes y medio de vida, 7 estrellas, 0
forks y un solo autor, y se describía como *work in progress*. Va en el
componente más sensible del producto —el que descarga y ejecuta código— así
que se copia bajo su licencia MIT en vez de depender del npm publicado: el
abandono o una versión maliciosa del upstream no nos alcanzan, y el código
queda auditable en el mismo repo que lo usa.

El riesgo real es acotado y conviene nombrarlo con precisión: **el trabajo
difícil lo hace Sparkle**, que tiene veinte años de rodaje. Lo vendoreado es
la capa de traducción, que es `sparkle_bridge.mm` y se lee de una sentada.

## Qué se copió, y qué no

Solo la parte nativa, que es la difícil:

- `src/sparkle_bridge.mm` — el puente Objective-C++ ↔ N-API.
- `binding.gyp` — la config de compilación, con los `rpath` que le permiten
  encontrar `Sparkle.framework` tanto en desarrollo como dentro del `.app`.
- `scripts/fetch-sparkle.sh` — baja Sparkle del release oficial y **verifica
  sha256** antes de extraer. Trae además `generate_keys`, `sign_update` y
  `generate_appcast`.

**No se copió el lado JavaScript.** El del upstream es ESM y resuelve la ruta
del addon asumiendo un layout de `node_modules`; este paquete es CommonJS
(`sandbox: true` lo obliga, ADR-132 §3) y tiene su propio layout. Treinta
líneas propias son más simples que adaptar las suyas, y evitan heredar
supuestos que acá no valen.

Tampoco se copió su CLI de appcast: `generate_appcast` y `sign_update` vienen
del propio Sparkle, que es la fuente autoritativa.

## `Sparkle.framework` no está en el repo

Son 3 MB de binario. Los baja `fetch-sparkle.sh` verificando sha256 contra el
pin del script — mismo criterio que ADR-018 aplica a los modelos y al wasm:
los bytes de terceros entran al build por una vía verificable, no por un
commit.

```bash
pnpm --filter @anonly/desktop-shell sparkle:fetch
```

## Actualizarlo

1. Mirar el diff del upstream desde el commit pineado arriba.
2. Copiar los archivos que cambien.
3. Actualizar la tabla de procedencia.
4. Recompilar y correr el smoke test del actualizador.

Es a mano y a propósito: es el precio de que el upstream no pueda cambiar este
código sin que alguien lo lea.
