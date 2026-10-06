<!-- CONTEXT: scope=ramas-develop-main | dependencias=adr/ADR-199,adr/ADR-208,RELEASING.md,.changeset/README.md | audiencia=planificador+implementador+revisor | fase=flujo-de-ramas -->

# ADR-209: la promoción de develop a main usa merge commit

**Estado:** Adoptado por el planificador a pedido del mantenedor — 2026-10-06.
La configuración de GitHub que lo sostiene fue aplicada por el mantenedor el
mismo día.

## Contexto

ADR-199 §5 promovía `develop` a `main` con Rebase and merge, sobre una rama
temporal rebaseada localmente. GitHub reescribe los SHA al rebasar, así que
los mismos cambios existían en las dos ramas como commits distintos. El
2026-10-06 `develop` estaba 38 commits por delante y 16 por detrás de `main`,
con una base común vieja (`165bd96`). Los 16 commits de `main` tenían un
parche equivalente en `develop` (`git cherry`), y aun así un merge real daba
conflicto en 8 archivos: los mismos cambios aplicados dos veces con distinto
SHA, más cambios nuevos encima. Cada promoción con rebase repetiría el costo.

El mantenedor es hoy la única persona que abre PR. Lo que debe ser lineal es
`develop`, donde se acumula el trabajo y se bisecta; `main` solo recibe
promociones.

## Decisión

1. **Hacia `develop`** se integra con Rebase and merge, o con squash para
   ramas cortas. `develop` conserva el historial lineal requerido: rechaza
   merge commits aunque el repositorio los permita. No cambia.
2. **De `develop` a `main`** se promueve con **Create a merge commit**. Los
   commits de `develop` conservan su SHA dentro de `main`. La siguiente
   promoción toma como base común la punta de `develop` de la anterior y solo
   trae lo nuevo, sin duplicados ni conflictos por "mismo parche, distinto
   SHA". Rebase y squash no se usan en esta promoción: reescriben los SHA.
3. **`main` no se reintegra a `develop`.** Un merge de `main` en `develop`
   sería un merge commit y `develop` lo rechaza; tampoco hace falta, por el
   punto anterior. Un hotfix hecho en `main` se lleva a `develop` por
   cherry-pick (ADR-199 §6). Queda con otro SHA y el mismo contenido, y Git
   fusiona sin conflicto un cambio idéntico en ambos lados.
4. **Configuración de GitHub.** El repositorio permite merge commits, y `main`
   deja de exigir historial lineal. `develop` lo sigue exigiendo. Los demás
   checks de ambas ramas no cambian (ADR-208).
5. **Conflictos en la promoción.** Si `git merge-tree --write-tree origin/main
   origin/develop` anticipa conflictos, se prepara una rama temporal
   `release/...` creada desde `main` con `git merge origin/develop`, y se
   abre el PR de esa rama hacia `main`, también con merge commit. Sin
   conflictos, el PR va directo de `develop` a `main`.
6. **Publicación.** El tag va sobre la punta de `main` con CI exitosa de push.
   La validación de `release.yml` ya lo permite: exige que el SHA sea
   ancestro de `main` y que tenga una corrida de CI exitosa de push en
   `main`. Un commit de `develop` que ya entró a `main` pero no tiene CI de
   push en `main` es rechazado.

## Aplicación inicial

Las dos ramas ya habían divergido por rebase. La rama temporal
`release/promote-develop` (`a30da93`) es un merge commit de `develop`
(`3dea826`) sobre `main` (`7f763b4`). Su árbol es idéntico al de `develop`:
se resolvieron los 8 conflictos tomando el lado de `develop`, porque cada
commit de `main` tiene un parche equivalente en `develop`. Es el único caso en
que ese costo se paga. Si `develop` avanza antes de promover, se le hace
`git merge origin/develop` y entra sin conflictos.

## Consecuencias

- `main` deja de ser lineal: su historial tiene un merge commit por
  promoción. `git log --first-parent main` muestra una línea por promoción.
- Las promociones no vuelven a duplicar commits entre las ramas, y un SHA de
  `develop` se puede buscar en `main`.
- Un merge accidental de un PR a `main` con merge commit ya no lo impide la
  configuración, solo la disciplina de usarlo únicamente para promover.
  Los PR de hotfix hacia `main` siguen integrándose con rebase o squash.

## Enmienda a ADR-199 y a ADR-208

Reemplaza ADR-199 §5 (merge commits deshabilitados, historial lineal en
`main`, promoción por Rebase and merge y sin sincronización inversa). El resto
de ADR-199 sigue vigente. ADR-208 §5 menciona "historial lineal y Rebase and
merge" como vigentes; desde este ADR solo valen para `develop`.

## Referencias

- ADR-199: rama `develop`, enmendado por este ADR.
- ADR-208: mismos checks en `develop` y `main`.
- `RELEASING.md` y `.changeset/README.md`: flujo operativo.
- `.github/workflows/release.yml`: validación del origen del tag.
