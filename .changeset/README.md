# Changesets

Este proyecto usa [Changesets](https://github.com/changesets/changesets) para gestionar versiones y CHANGELOG.

## Flujo

1. Cuando un PR introduce un cambio user-facing (feature, fix, breaking), ejecutá:

   ```bash
   pnpm changeset
   ```

   Respondé las preguntas (paquete afectado, tipo de bump: major/minor/patch, mensaje).

   Esto genera un archivo `.changeset/<random-name>.md` que **se commitea en el PR**.

2. Al mergear el PR, el archivo queda en `main`.

3. Cuando se quiere liberar una nueva versión, ejecutá:

   ```bash
   pnpm version
   ```

   Changesets consume todos los `.changeset/*.md` pendientes, actualiza los `package.json` de los paquetes afectados, actualiza sus `CHANGELOG.md` y remueve los archivos consumidos.

4. Luego commiteá el "Version Packages" resultante y taggeá:

   ```bash
   git commit -am "chore: version packages"
   git tag v0.1.0
   git push origin main --tags
   ```

5. Para publicar a npm (cuando aplique, v1.0+):

   ```bash
   pnpm release
   ```

## Tipos de bump

| Tipo | SemVer | Cuándo |
|---|---|---|
| `major` | `X.0.0` | cambio breaking de contrato público |
| `minor` | `0.X.0` | nueva feature compatible |
| `patch` | `0.0.X` | bug fix |

## Reglas del proyecto

- Toda feature o fix user-facing requiere un changeset. PRs solo de docs, refactor interno o tooling no necesitan changeset (usá `chore: ...`).
- Para cambios que afectan `@anonly/shared` o `@anonly/anonymization-core`, el changeset es **obligatorio** porque son paquetes publicables.
- `@anonly/react-client` está en `ignore` porque la app web no se publica a npm (es un build estático).
- Los `docs/*` no requieren changeset.
- Cuando un changeset dice `major`, verificá que haya un ADR que lo justifique.
