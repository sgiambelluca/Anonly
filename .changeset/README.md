# Changesets

Anonly usa [Changesets](https://github.com/changesets/changesets) para gestionar
una versión común de la app y sus CHANGELOG. Los paquetes privados se versionan
juntos; no se publican librerías a npm.

## Flujo

1. Creá la rama de trabajo desde `develop`. Para un cambio visible en la app,
   ejecutá:

   ```bash
   pnpm changeset
   ```

   Respondé las preguntas (paquete afectado, tipo de bump: major/minor/patch, mensaje).

   Esto genera un archivo `.changeset/<random-name>.md` que **viaja en el PR hacia `develop`**.

2. Los PR integrados acumulan changesets en `develop`.

3. Para preparar una versión, creá una rama desde `develop` y ejecutá:

   ```bash
   pnpm run version
   ```

   Changesets consume todos los `.changeset/*.md` pendientes, actualiza las versiones y los CHANGELOG y remueve los archivos consumidos. Integrá ese cambio por PR a `develop`.

4. Probá el conjunto y promové `develop` a `main` con un PR directo y **Create a
   merge commit** (ADR-209): así los commits conservan su SHA. No uses Rebase
   ni squash en la promoción ni mergees `main` en `develop`. La primera
   promoción es la excepción y usa `release/promote-develop`; los pasos están
   en `RELEASING.md`. Esperá CI exitosa de push en `main` para el SHA que vas
   a tagear.

5. Creá y pusheá solo el tag de esa versión, coincidente con
   `apps/desktop-shell/package.json`. El workflow crea un release en borrador;
   el mantenedor revisa y publica los instaladores. Los hotfixes exclusivos de
   `main` se trasladan a `develop` mediante cherry-pick en una rama de trabajo
   y PR, como explica `RELEASING.md`.

El flujo completo, los hotfixes y las pruebas de instaladores están en
[`RELEASING.md`](../RELEASING.md).

## Tipos de bump

| Tipo | SemVer | Cuándo |
|---|---|---|
| `major` | `X.0.0` | cambio breaking de contrato público |
| `minor` | `X.Y.0` | nueva feature compatible |
| `patch` | `X.Y.Z` | bug fix |

## Reglas del proyecto

- Toda feature o fix user-facing requiere un changeset. PRs solo de docs, refactor interno o tooling no necesitan changeset (usá `chore: ...`).
- Los paquetes `@anonly/*` se versionan juntos (`fixed`), incluidos el cliente React y el contenedor de escritorio. `ignore` está vacío.
- Los `docs/*` no requieren changeset.
- Cuando un changeset dice `major`, verificá que haya un ADR que lo justifique.
