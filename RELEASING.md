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

**1. Creá una rama de trabajo desde `develop`.** Features, fixes y documentación
abren PR hacia `develop`. Si el cambio afecta lo que ve quien usa la app,
agregá un changeset:

```bash
pnpm changeset
```

Elegís patch / minor / major y escribís una línea de qué cambió. Eso deja un
`.md` en `.changeset/` que viaja en el PR.

**2. Integrás el PR a `develop`.** Ahí se acumulan los changesets de la próxima
versión y se prueban todos los cambios juntos. No se publica ninguna actualización.

**3. Cuando querés publicar**, aplicás los changesets acumulados en una rama
de preparación creada desde `develop` y abrís PR hacia ella:

```bash
pnpm run version   # sube las versiones y escribe los CHANGELOG
```

Tiene que ser `pnpm run version`: `pnpm version` a secas es un comando propio
de pnpm, que imprime versiones y no toca nada.

**4. Probás la versión y preparás un PR hacia `main`, con Rebase and merge.**
`main` y `develop` conservan historial lineal y ambas ramas son permanentes.
Para preparar la promoción sin reescribir `develop`, creá una rama temporal
desde ella y rebaseala sobre el último `main` antes de abrir el PR:

```bash
git fetch origin
git switch -c release/1.1.0 origin/develop
git rebase origin/main
```

El rebase local omite los patches equivalentes que ya están en `main` y permite
resolver conflictos en la rama temporal. Revisá el diff final del PR y repetí
las pruebas afectadas si la resolución cambia el contenido. Después integrá
ese PR mediante Rebase and merge. No rebasees ni fuerces el push de `develop`.

GitHub crea nuevos SHA al hacer Rebase and merge. Por eso las promociones no
conservan la misma identidad de commits entre las dos ramas. No hace falta
reintegrar toda la historia de `main` a `develop` después de cada promoción;
los hotfixes y cualquier cambio exclusivo de `main` se trasladan por separado.

**5. Esperás CI verde en `main` y tageás el commit validado.** El tag debe coincidir exactamente con `v` + la versión de `apps/desktop-shell/package.json`. La validación del release rechaza un commit fuera de `main`, un tag que no coincide o un SHA sin CI exitosa. El tag dispara el release:

```bash
git switch main
git pull --ff-only origin main
git tag v1.1.0
git push origin v1.1.0
```

`.github/workflows/release.yml` buildea en un runner de macOS y uno de
Windows, corre un **smoke test sobre el binario ya empaquetado** —lo arranca de
verdad y verifica que sirva su propio origen `app://`— y recién ahí sube los
instaladores.

Ese smoke test existe por Windows: el `.exe` se puede construir desde macOS
pero no ejecutar, así que sin un runner de Windows abriéndolo una vez, esa
plataforma se publicaría sin que nadie la haya visto arrancar.

En macOS el instalador es universal (arm64 + x86_64) y además firma cada actualización con la clave EdDSA (el secret
`SPARKLE_PRIVATE_KEY`, que entra por stdin y nunca toca el disco del runner) y
publica el `appcast.xml` que la app consulta.

El job produce un único ZIP actualizable por Sparkle. No se deben copiar dos
ZIP de arquitecturas distintas al directorio `updates/`: Sparkle rechaza dos
archivos con el mismo número de versión. El bridge nativo de Sparkle se
compila para ambas arquitecturas y se valida antes de empaquetar (ADR-138).

Ese paso **falla el build** si la clave privada no corresponde a la
`SUPublicEDKey` horneada en la app, o si el appcast sale sin firma.
`generate_appcast` solo avisa en ese caso y genera el archivo igual; publicarlo
sería peor que no publicar nada, porque cada usuario descargaría la
actualización y la rechazaría sin que el release dé ninguna señal.

En Windows el secret equivalente es `WINDOWS_UPDATE_PRIVATE_KEY`, una privada
Ed25519 PKCS#8 en PEM. El job la entrega por stdin al firmador y agrega a
`latest.yml` un sobre que ata versión, nombre y SHA-512 del `.exe`. La pública
SPKI está horneada en `src/windows-update-signature.ts`; si el secret no
corresponde a ella, falta o no se genera la metadata `anonlyEd25519`, el release
falla antes de subir artefactos (ADR-137).

La firma propia protege actualizaciones, no la primera instalación. Hasta que
se integre Authenticode mediante SignPath, Windows puede mostrar SmartScreen y
un editor no verificado. Cuando llegue el certificado, el verificador exige
las dos firmas; la Ed25519 no se retira.

**El release se crea como borrador.** El tag lo arma; publicarlo lo decidís
vos, desde la página del release. Hasta entonces ningún usuario lo recibe.

`workflow_dispatch`, seleccionado sobre `main` o `develop`, corre todo el
pipeline sin crear un release: deja los instaladores como artifacts de Actions
para probar antes de tagear. Exige CI exitosa de push para ese SHA en la rama
seleccionada. Los jobs de Windows y macOS exigen y usan
sus respectivos secrets (`WINDOWS_UPDATE_PRIVATE_KEY` y
`SPARKLE_PRIVATE_KEY`) en esa prueba: es la forma segura de validar ambos
circuitos de firma sin crear todavía un release.

## Entorno protegido y aprobación

El workflow declara el entorno `release` en los jobs de firma y de publicación
(ADR-139). En Settings → Environments → release deben estar:

- Revisor requerido: `sgiambelluca`. La autoaprobación está permitida mientras
  el proyecto tenga un solo autor; no es una segunda revisión independiente.
- Ramas/tags permitidos: ramas `main` y `develop`, y tags `v*`.
- Environment secrets: `SPARKLE_PRIVATE_KEY` y `WINDOWS_UPDATE_PRIVATE_KEY`.
  No deben quedar copias con alcance de repositorio u organización.

Al ejecutar el workflow, abrí Actions → Release → ejecución → Review deployments.
Verificá el SHA, el tag y el resultado de CI antes de aprobar el entorno. Los
secrets se entregan al job después de esa aprobación. Para probar desde
`develop`, revisá también los cambios del workflow antes de aprobar: recibe las
mismas claves de firma. No apruebes ejecuciones de ramas de trabajo arbitrarias.

Para migrar claves existentes, agregá sus valores originales al entorno,
confirmá que ambos nombres están presentes y retiralos del alcance repositorio.
No cambies las claves públicas ni generes pares nuevos durante esa migración.
Probá después con Run workflow sobre `main`; la prueba también solicita
aprobación y no crea un release. Mantené el workflow pausado hasta terminar la
configuración y publicar su versión protegida.

Las actions se fijan a commits completos. Revisá los PR de Dependabot de
`github-actions` antes de integrar cambios. Los tokens de build solo leen el
repositorio; la escritura y la atestación están limitadas al job de publicación.

## Nombres y hashes de los archivos

El job de publicación normaliza espacios a puntos en los nombres de assets
antes de escribir `SHA256SUMS.txt`, para que coincidan con las descargas de
GitHub. Los bytes y manifiestos firmados no se modifican. El proceso rechaza
colisiones y no incluye el propio manifest dentro de su lista de hashes.

Descargá los assets y `SHA256SUMS.txt` en una misma carpeta. En macOS verificá
con `shasum -a 256 -c SHA256SUMS.txt`; en Linux, con
`sha256sum --check SHA256SUMS.txt`. Si falta un archivo listado, la comprobación
de ese archivo falla: descargalo antes de concluir que está corrupto.

## Mantenimiento de tags e historial

Las etiquetas de versión se protegen contra actualización y borrado. No muevas
una etiqueta para distribuir binarios diferentes con el mismo número de versión.
Una reescritura por datos sensibles es mantenimiento excepcional: requiere
respaldo privado, release pausado, mapeo verificado de referencias y restitución
de las protecciones al terminar.

Cuando se sanea el historial sin reconstruir una publicación anterior, los
instaladores conservan sus bytes y firmas. Sus atestaciones siguen apuntando al
commit original de construcción; no se presentan como emitidas sobre el nuevo
hash del tag. Los ZIP/tar de fuentes automáticos corresponden al tag saneado.
Las copias cacheadas y referencias de PR pueden requerir asistencia de GitHub.

## Probar sin romperle la app a nadie

El workflow crea un borrador y marca como pre-release los tags con guion, como
`v0.9.3-beta.1`. Revisá el canal elegido antes de publicar el borrador.

Mientras solo haya pre-releases, GitHub responde 404 a `releases/latest`; el
feed estable de Sparkle no tiene una publicación de la que leer. Conservar una
pre-release no resuelve esa ausencia. No la marques estable para esconder el
404: publicá una versión estable cuando esté validada para ese uso. El
comportamiento del actualizador de la app se valida en su trabajo específico.

Y si una versión mala llega igual a producción, se arregla publicando el
arreglo: el updater se lo empuja a todos. Es para lo que sirve tener
actualizaciones automáticas.

## Protecciones de main y develop

`main` es la rama estable y sigue siendo la rama por defecto de GitHub.
`develop` es la rama de integración de la próxima versión (ADR-199).

Ambas exigen PR, conversaciones resueltas y prohíben force pushes y borrado.
Los checks se aplican también al administrador y se vinculan a GitHub Actions.

| Protección                                         | `develop`                                       | `main`                              |
| -------------------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| Lint, Typecheck, Unit + Contract + Snapshot, Build | requeridos                                      | requeridos                          |
| Security audit y Security gates                    | requeridos                                      | requeridos                          |
| E2E (Playwright)                                   | después de integrar; no bloquea el PR cotidiano | requerido                           |
| Rama actualizada antes del merge                   | no requerido                                    | requerido                           |
| Performance                                        | después de integrar y a mano                    | en PR, después de integrar y a mano |
| Memory leak y Stress                               | a mano                                          | después de integrar y a mano        |

El ruleset de actualización de ambas ramas autoriza **solo a `sgiambelluca`** a
integrar cambios, con una excepción limitada a merges de PR. No exime los checks
de branch protection. `CODEOWNERS` solicita su revisión de todos los archivos.
No se exige un segundo revisor para sus propios PRs: GitHub no permite aprobar
un PR propio. No se otorgan permisos de administración a colaboradores externos.

Los merge commits están deshabilitados y ambas ramas exigen historial lineal.
Rebase and merge se usa para las promociones; squash sigue disponible para
las ramas cortas. La protección contra borrado conserva las ramas permanentes
aunque GitHub elimine automáticamente las ramas mergeadas.

## Arreglos urgentes

Si la versión publicada necesita un parche mientras `develop` contiene cambios
incompletos, creá `hotfix/...` desde `main`, agregá el changeset y aplicá el bump
del parche allí. Abrí PR hacia `main`, probá el arreglo, esperá su CI y publicá
el tag como en el flujo anterior. Después creá una rama desde `develop`, llevá
los commits del parche mediante cherry-pick y abrí PR hacia `develop`. Resolvé
la versión y los CHANGELOG para conservar el parche junto al trabajo pendiente.

La rama temporal `release/...` se usa para preparar la promoción con historial
lineal; puede eliminarse después de integrar su PR.
