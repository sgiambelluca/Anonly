# @anonly/desktop-shell

## 1.0.1

### Patch Changes

- Las actualizaciones muestran el avance de la descarga en una tarjeta, se instalan sin asistente y, con «Instalar automáticamente», al cerrar Anonly (en macOS, al abrirlo). El instalador se vuelve a verificar antes de usarse y Windows lo vuelve a correr si la instalación se corta (ADR-197). El instalador de Windows se publica con el nombre que indica su manifiesto (ADR-198).

## 1.0.0

### Major Changes

- Primera versión estable. El estado del producto y sus limitaciones conocidas están en `docs/roadmap/Version_1.0.md`.

### Minor Changes

- df0c629: La búsqueda automática de actualizaciones se puede apagar desde Configuración (ADR-188).

### Patch Changes

- 6d989b3: El instalador incluye los textos de licencia del software de terceros que distribuye, y «Acerca de» lista los componentes principales (ADR-196).

## 0.9.2

### Patch Changes

- 9058528: Corrige el empaquetado de macOS para publicar un instalador universal y un único appcast de Sparkle.

## 0.9.1

### Patch Changes

- b7bfc21: Verifica las actualizaciones de Windows con una firma Ed25519 propia antes de
  aceptar el instalador descargado.
