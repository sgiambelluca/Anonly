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
4. **Configuración de GitHub.** El repositorio permite merge commits. `main`
   deja de exigir historial lineal y también de exigir la rama actualizada
   antes del merge; `develop` conserva las dos reglas. Los demás checks de
   ambas ramas no cambian (ADR-208).
5. **La promoción es un solo PR de `develop` hacia `main`**, sin rama
   intermedia. GitHub mergea a partir de la base común de las dos ramas, que
   tras la primera promoción es la última punta de `develop` ya promovida: que
   `main` tenga un merge commit que `develop` no contiene no afecta el
   resultado, y solo entran los commits nuevos. `main` no exige estar
   actualizada porque esa regla bloquearía cada promoción después de la
   primera: la punta de `main` es un merge commit que `develop` no contiene, y
   ponerlo al día exigiría un merge de `main` en `develop`, que `develop`
   rechaza. A `main` solo entran promociones y hotfixes, y el CI de un PR ya
   prueba el resultado del merge con la base de ese momento. Los conflictos se
   anticipan con `git merge-tree --write-tree origin/main origin/develop`.
6. **Publicación.** El tag va sobre la punta de `main` con CI exitosa de push.
   La validación de `release.yml` ya lo permite: exige que el SHA sea
   ancestro de `main` y que tenga una corrida de CI exitosa de push en
   `main`. Un commit de `develop` que ya entró a `main` pero no tiene CI de
   push en `main` es rechazado.

## Aplicación inicial

Las dos ramas ya habían divergido por rebase, así que la primera promoción es
la única que necesita una rama intermedia. `release/promote-develop` es un
merge commit de `develop` sobre `main` (`7f763b4`), con los 8 conflictos
resueltos tomando el lado de `develop`: cada commit de `main` tiene un parche
equivalente en `develop`, de modo que su árbol es idéntico al de `develop`. Si
`develop` avanza antes de promover, se le hace `git merge origin/develop` y
entra sin conflictos. Esa rama se integra con merge commit, y desde la
siguiente promoción el PR va directo de `develop` a `main`.

## Consecuencias

- `main` deja de ser lineal: cada promoción deja un merge commit.
  `git log --first-parent main` muestra una línea por promoción.
- Las promociones no vuelven a duplicar commits entre las ramas, y un SHA de
  `develop` se puede buscar en `main`.
- Un merge accidental de un PR a `main` con merge commit ya no lo impide la
  configuración, solo la disciplina de usarlo únicamente para promover.
  Los PR de hotfix hacia `main` siguen integrándose con rebase o squash.
- `main` pierde la garantía de que un PR se probó contra su última punta. Se
  acepta: no hay PR en paralelo hacia `main`, y el CI de push en `main` corre
  igual sobre cada promoción antes de tagear.

## Enmienda a ADR-199 y a ADR-208

Reemplaza ADR-199 §5 (merge commits deshabilitados, historial lineal en
`main`, promoción por Rebase and merge y sin sincronización inversa). El resto
de ADR-199 sigue vigente. De ADR-208, la exigencia de la rama actualizada (§2)
queda solo para `develop`, y §5 menciona "historial lineal y Rebase and merge"
como vigentes: desde este ADR solo valen para `develop`.

## Referencias

- ADR-199: rama `develop`, enmendado por este ADR.
- ADR-208: mismos checks en `develop` y `main`.
- `RELEASING.md` y `.changeset/README.md`: flujo operativo.
- `.github/workflows/release.yml`: validación del origen del tag.
