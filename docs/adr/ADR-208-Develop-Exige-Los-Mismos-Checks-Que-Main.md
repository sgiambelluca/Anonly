<!-- CONTEXT: scope=ci-develop-main | dependencias=adr/ADR-199,architecture/07_Performance_Strategy.md,RELEASING.md | audiencia=planificador+implementador+revisor | fase=ci-post-merge-54 -->

# ADR-208: develop exige los mismos checks que main

**Estado:** Adoptado por el planificador a pedido del mantenedor — 2026-10-06.

## Contexto

ADR-199 §3 dejó E2E y Performance fuera de los PR hacia `develop`: corrían
después de integrar, y solo un PR hacia `main` los exigía. El costo se vio el
2026-10-06. El PR #54 hacia `develop` pasó con todos sus checks verdes, sin
E2E, y el push posterior a `develop` (run 37532383935, `902fc03`) falló en
"E2E mitad 1/2": el spec `mode-menu-opens-upward` no cumple en macOS. El
mismo patrón había roto el run 37502791346 tras integrar #53. Los fallos de
E2E llegaban cuando el cambio ya estaba integrado y había que arreglarlos con
otro PR.

Las diferencias entre las protecciones de ambas ramas, tomadas de la API de
GitHub y de `RELEASING.md`, eran tres:

1. `E2E (Playwright)` es requerido en `main` y no en `develop`; en PR hacia
   `develop` el job ni siquiera corría.
2. `main` exige la rama actualizada antes del merge (`strict`); `develop` no.
3. Performance corre en PR hacia `main`, y no en PR hacia `develop`. No es un
   check requerido en ninguna de las dos.

## Decisión

1. `develop` exige los mismos checks que `main`: Lint, Typecheck, Unit +
   Contract + Snapshot, Build, Security audit, Security gates y
   `E2E (Playwright)`.
2. `develop` exige la rama actualizada antes del merge, igual que `main`.
3. E2E, Export verification y Performance corren en todo PR y push a `main` y
   `develop`, y a mano. Se retira el filtro `github.base_ref == 'main'` de
   `ci.yml`. Performance sigue sin ser un check requerido, como en `main`.
4. El agregador `E2E (Playwright)` conserva su definición: exige las dos
   mitades de E2E y `Export verification`. `Export verification` se mantiene
   en `develop` aunque `main` todavía no lo tenga: llega a `main` en la
   promoción.
5. Leak y Stress no cambian: corren en pushes a `main` y a mano, y no son
   checks de PR en ninguna de las dos ramas. El resto de ADR-199 (ruleset de
   actualización, historial lineal, Rebase and merge, hotfixes, Changesets,
   Release) sigue vigente.

## Consecuencias

- Cada PR hacia `develop` suma tres jobs en macOS (dos mitades de E2E,
  Export verification y Performance). Se acepta el costo de CI a cambio de
  que un fallo de E2E se vea antes de integrar. Los runners de macOS son
  gratis en un repositorio público.
- Exigir la rama actualizada obliga a rebasar un PR cuando otro entra antes.
  Es la misma regla que ya rige para `main`.
- La protección de rama de `develop` es configuración de GitHub y no vive en
  el repositorio. Cambiarla es un paso aparte de este ADR y debe hacerse
  después de que el workflow nuevo esté en `develop`, para que el check
  `E2E (Playwright)` exista en los PR que lo exigen.

## Enmienda a ADR-199

Reemplaza §2 (lista de checks y "no exige estar actualizada antes de cada
merge") y §3 (E2E y Performance después de integrar). Sustituye también la
frase de ADR-148 y ADR-203 "no añade este costo a cada PR hacia develop".

## Referencias

- ADR-199: rama `develop`, enmendado por este ADR.
- ADR-148 y ADR-203: el gate `Export verification`.
- `.github/workflows/ci.yml`: eventos de cada job.
- `RELEASING.md` y `architecture/07_Performance_Strategy.md` §11.4: tabla de
  protecciones y selección de ramas.
