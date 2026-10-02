<!-- CONTEXT: scope=adr | dependencias=RELEASING.md,adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,adr/ADR-137-Windows-Verifica-Actualizaciones-Con-Clave-Ed25519-Propia.md,adr/ADR-138-Instalador-Universal-De-macOS.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,roadmap/Roadmap_1.x.md | audiencia=humanos+IA | fase=1.0.1 -->

# ADR-198 — Un archivo publicado se llama como dice su manifiesto

- **Estado**: Aceptado.
- **Fecha**: 2026-10-02.
- **Decidido por**: el planificador, sobre el defecto que apareció al
  publicar la 1.0.0. El humano pidió el arreglo de fondo para la 1.0.1.
- **Alcance**: `.github/scripts/` y `.github/workflows/release.yml`. No toca
  el producto.
- **Versión**: 1.0.1.

## Contexto

Al publicar la 1.0.0, las instalaciones de la 0.9.2 en Windows encontraban la
versión nueva y no podían bajarla.

- `latest.yml`, que genera `electron-builder`, nombra al instalador
  `Anonly-Setup-1.0.0.exe`, con guiones. Es el nombre que el actualizador
  pide, y el que ata la firma Ed25519 (ADR-137).
- `.github/scripts/prepare-release-assets.mjs` renombra los archivos antes de
  subirlos, cambiando cada espacio por un **punto**: el instalador quedó
  publicado como `Anonly.Setup.1.0.0.exe`.
- La dirección con guiones respondía 404. La 0.9.2 tenía el mismo desajuste;
  no se había visto porque no existía ninguna versión posterior.

Se arregló a mano, sin republicar: se subió al release una copia del
instalador y de su `.blockmap` con el nombre de guiones. Los bytes son los
mismos, así que la firma del manifiesto valida sin cambios. La 0.9.2 se
actualizó a la 1.0.0 desde la aplicación después de eso.

macOS no estaba afectado: sus archivos no llevan espacios.

## Decisión

### 1. El nombre lo fija el manifiesto

`prepare-release-assets.mjs` deja de inventar un nombre. Para cada archivo
con espacios, el nombre publicado es el que le da el manifiesto que lo
nombra (`latest.yml`, `latest-mac.yml` o `appcast.xml`). Hoy eso es cambiar
los espacios por guiones, que es la regla de `electron-builder`.

Un archivo con espacios que ningún manifiesto nombra sigue la misma regla de
guiones. El `.blockmap` sigue a su instalador: el actualizador lo pide como
el nombre del instalador más `.blockmap`.

### 2. El release falla si un manifiesto nombra algo que no se publica

Después de normalizar, y antes de escribir `SHA256SUMS.txt`, el script
comprueba que **cada archivo que un manifiesto nombra existe** en el conjunto
que se va a subir, con ese nombre exacto:

- `latest.yml` y `latest-mac.yml`: cada `url` de `files` y el `path`;
- `appcast.xml`: el nombre de archivo de cada `enclosure`;
- la metadata `anonlyEd25519` de `latest.yml`: su campo `file`.

Si falta uno, el script termina con error y el job no publica. Un manifiesto
ausente no es un error del script: que estén los manifiestos lo exigen los
jobs de build.

Para `latest.yml`, además, compara el `sha512` y el tamaño declarados contra
el archivo. Es la misma comprobación que hace el actualizador al bajarlo.

### 3. Sin dependencias

Los manifiestos se leen con expresiones acotadas a las líneas que hacen
falta, no con un parser de YAML ni de XML nuevo (R-12). Si una línea no se
puede leer, el script falla: no adivina.

### 4. La 1.0.0 queda como está

Su release conserva el instalador con los dos nombres. No se retira ninguno:
el de puntos figura en `SHA256SUMS.txt` y puede estar enlazado desde afuera.

## Cómo se verifica

- Tests del script (`node --test`, los que ya corre el job de Lint): los
  nombres con espacios quedan con guiones; un manifiesto que nombra un
  archivo ausente hace fallar; un `sha512` o un tamaño que no coincide hace
  fallar; el caso del release de la 1.0.0 —instalador con puntos y manifiesto
  con guiones— falla.
- La corrida de prueba de `release.yml` por `workflow_dispatch` antes del tag
  de la 1.0.1. Ese disparo no llega al job de publicación, así que **la
  comprobación nueva se ejecuta por primera vez al tagear**. Para cubrirla
  antes, el paso se mueve o se repite en un punto que también corra en la
  ejecución manual.

## Consecuencias

- El instalador de Windows pasa a publicarse como
  `Anonly-Setup-<versión>.exe`. `README.md` y `RELEASING.md` no enlazan al
  instalador por nombre, así que no hay enlaces que actualizar.
- `SHA256SUMS.txt` lista los nombres con guiones.
