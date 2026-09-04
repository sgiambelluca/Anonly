# Publicar una versión

Anonly se distribuye como **instalador de escritorio** por GitHub Releases. No
hay hosting, dominio ni servidor: la app no se sirve, se descarga (ADR-130,
ADR-131 §1).

## Un solo número para toda la app

`.changeset/config.json` agrupa los paquetes en `fixed`, así que **todos se
mueven juntos**. Anonly no publica librerías a npm: lo que se versiona es el
producto, y el actualizador compara **una** versión, no trece.

La versión que manda es la de `apps/desktop-shell/package.json` — es la que
`electron-builder` embebe en el instalador y contra la que el updater decide
si hay algo nuevo.

> El `package.json` de la raíz queda en `0.0.0` a propósito. No es un artefacto
> que se publique y Changesets no lo maneja: ponerlo en `0.9.0` lo dejaría
> desincronizado en el próximo bump, que es peor que verlo en cero.

## El flujo

**1. Al hacer un cambio**, agregá un changeset:

```bash
pnpm changeset
```

Elegís patch / minor / major y escribís una línea de qué cambió. Eso deja un
`.md` en `.changeset/` que viaja en el PR.

**2. Mergeás a `main` normalmente.** No se publica nada: `main` acumula
changesets sin que ningún usuario reciba una actualización.

**3. Cuando querés publicar**, aplicás los changesets acumulados:

```bash
pnpm version   # sube las versiones y escribe los CHANGELOG
```

**4. Tageás.** El tag es lo que dispara el release, no el merge:

```bash
git tag v0.9.0 && git push origin v0.9.0
```

`.github/workflows/release.yml` buildea en un runner de macOS y uno de
Windows, corre un **smoke test sobre el binario ya empaquetado** —lo arranca de
verdad y verifica que sirva su propio origen `app://`— y recién ahí sube los
instaladores.

Ese smoke test existe por Windows: el `.exe` se puede construir desde macOS
pero no ejecutar, así que sin un runner de Windows abriéndolo una vez, esa
plataforma se publicaría sin que nadie la haya visto arrancar.

**El release se crea como borrador.** El tag lo arma; publicarlo lo decidís
vos, desde la página del release. Hasta entonces ningún usuario lo recibe.

`workflow_dispatch` corre todo el pipeline sin publicar nada, para probar que
el camino funciona antes de tagear.

## Probar sin romperle la app a nadie

Un tag de prerelease (`v0.9.1-beta.1`) marcado como _prerelease_ en GitHub
**no llega a los usuarios normales**. Se prueba, y si está bien se promueve.

Y si una versión mala llega igual a producción, se arregla publicando el
arreglo: el updater se lo empuja a todos. Es para lo que sirve tener
actualizaciones automáticas.

## Por qué no hay branch de producción

Porque el tag ya es el punto de corte. Una branch de release solo hace falta
para parchear una versión vieja mientras `main` avanzó hacia otra cosa — un
problema que este proyecto puede no tener nunca, y que si aparece se resuelve
creando la branch ese día.
