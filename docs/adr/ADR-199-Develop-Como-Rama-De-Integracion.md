# ADR-199: develop como rama de integración

**Estado:** Aceptado — 2026-10-02. §2 y §3 enmendados por ADR-208 (2026-10-06): `develop` exige los mismos checks que `main`, incluido E2E. §5 enmendado por ADR-209 (2026-10-06): la promoción a `main` usa merge commit.

## Contexto

Después de publicar 1.0.0 y el parche 1.0.1, el mantenedor decide acumular
los cambios de la próxima versión en una rama separada y probarlos juntos
antes de integrarlos a `main`. La integración cotidiana necesita checks más
livianos, pero el control de quién mergea se conserva en ambas ramas.

## Decisión

1. `develop` es la rama permanente de integración y `main` conserva el código
   estable. Las ramas de features, fixes y documentación nacen normalmente de
   `develop` y abren PR hacia ella. GitHub mantiene `main` como rama por defecto.
2. `develop` exige PR, Lint, Typecheck, Unit + Contract + Snapshot, Build,
   Security audit y Security gates. Los checks siguen vinculados a GitHub
   Actions. No exige estar actualizada antes de cada merge. No admite force
   pushes ni borrado y exige historial lineal y resolver conversaciones. Las ramas de trabajo
   permiten guardar avances que todavía no pasan estos checks.
3. E2E y Performance corren después de integrar a `develop`, en PR dirigidos a
   `main`, en pushes a `main` y a mano. Leak y Stress conservan su ejecución en
   pushes a `main` y a mano. Los gates requeridos de `main` no se reducen.
4. Un ruleset de actualización para `main` y `develop` permite integrar solo al
   mantenedor, mediante PR. Su excepción está limitada a PR, y los checks de
   branch protection se aplican también al administrador. Colaboradores con
   escritura pueden proponer cambios, pero el merge lo realiza el mantenedor.
   `CODEOWNERS` solicita su revisión de todos los archivos. No se exige otra
   aprobación al autor de sus propios PRs.
5. Se mantienen los merge commits deshabilitados y el historial lineal de
   `main`; también se exige historial lineal en `develop`. La promoción usa
   Rebase and merge sobre una rama temporal creada desde `develop` y rebaseada
   localmente sobre `main`, para omitir patches ya integrados y resolver
   conflictos antes del PR. No se reescribe ni se fuerza el push de `develop`.
   Los nuevos SHA que genera GitHub no se sincronizan de vuelta mediante una
   promoción inversa. Las ramas cortas pueden integrarse con squash.
   `develop` está protegida contra borrado aunque GitHub elimine automáticamente
   las ramas cortas mergeadas.
6. Los hotfixes nacen de `main`, se prueban e integran allí y se llevan luego a
   una rama de trabajo desde `develop` mediante cherry-pick y PR. Las versiones
   y los CHANGELOG se resuelven preservando el parche y el trabajo pendiente.
7. Changesets usa `develop` como base y Dependabot dirige sus PRs a ella.
   El bump se prepara en `develop` antes de promover la versión a `main`.
8. El workflow manual de Release admite `develop` para generar artifacts de
   prueba, con CI exitosa de push en esa rama y aprobación del entorno
   `release`. Solo los tags cuyo commit pertenece a `main`, con versión
   coincidente y CI exitosa de push en `main`, pueden crear releases en borrador.
   Los artifacts de `develop` no crean releases ni cambian el feed estable.

## Referencias

- `RELEASING.md`: flujo operativo y protecciones configuradas en GitHub.
- `.github/workflows/ci.yml`: selección de ramas y gates por evento.
- `.github/workflows/release.yml`: separación entre prueba y publicación.
- ADR-131, ADR-139 y ADR-185: publicación por tag, aprobación del entorno y
  ejecución de los gates pesados.
