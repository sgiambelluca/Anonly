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

**4. Esperás CI verde en `main` y tageás ese commit.** El tag debe coincidir exactamente con `v` + la versión de `apps/desktop-shell/package.json`. La validación del release rechaza un commit fuera de `main`, un tag que no coincide o un SHA sin CI exitosa. El tag dispara el release:

```bash
git tag v0.9.3
git push origin v0.9.3
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

`workflow_dispatch`, seleccionado sobre `main`, corre todo el pipeline sin publicar nada, para probar que
el camino funciona antes de tagear. Los jobs de Windows y macOS exigen y usan
sus respectivos secrets (`WINDOWS_UPDATE_PRIVATE_KEY` y
`SPARKLE_PRIVATE_KEY`) en esa prueba: es la forma segura de validar ambos
circuitos de firma sin crear todavía un release.

## Entorno protegido y aprobación

El workflow declara el entorno `release` en los jobs de firma y de publicación
(ADR-139). En Settings → Environments → release deben estar:

- Revisor requerido: `sgiambelluca`. La autoaprobación está permitida mientras
  el proyecto tenga un solo autor; no es una segunda revisión independiente.
- Ramas/tags permitidos: rama `main` y tags `v*`.
- Environment secrets: `SPARKLE_PRIVATE_KEY` y `WINDOWS_UPDATE_PRIVATE_KEY`.
  No deben quedar copias con alcance de repositorio u organización.

Al ejecutar el workflow, abrí Actions → Release → ejecución → Review deployments.
Verificá el SHA, el tag y el resultado de CI antes de aprobar el entorno. Los
secrets se entregan al job después de esa aprobación. No apruebes un workflow
modificado en una rama de trabajo, aunque la interfaz lo permita seleccionar.

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

## Por qué no hay branch de producción

Porque el tag ya es el punto de corte. Una branch de release solo hace falta
para parchear una versión vieja mientras `main` avanzó hacia otra cosa — un
problema que este proyecto puede no tener nunca, y que si aparece se resuelve
creando la branch ese día.
