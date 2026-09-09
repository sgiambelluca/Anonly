<!-- CONTEXT: scope=adr | dependencias=adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,RELEASING.md,ai/AI_Development_Guide.md | audiencia=humanos+IA | fase=hardening-github -->

# ADR-139 — La firma de releases requiere un entorno protegido

- **Estado**: Accepted; configuración y publicación verificadas por separado.
- **Fecha**: 2026-09-08.
- **Decisión**: proteger la distribución y sanear el repositorio, a pedido del humano. No se modifica el runtime de la aplicación.

## Problema

El workflow de release podía ejecutarse manualmente desde cualquier rama y sus claves de firma eran secrets del repositorio. Un cambio del workflow en una rama podía solicitar esas claves sin pasar por una aprobación de release. Los permisos de escritura y atestación también estaban disponibles en jobs que solo necesitaban leer código.

Los tags mutables de actions añadían otra dependencia de confianza: una actualización de la referencia externa podía cambiar lo ejecutado sin modificar este repositorio. Además, los nombres de los archivos de Windows se normalizaban al subirlos a GitHub, después de escribir `SHA256SUMS.txt`.

## Decisión

1. Las claves `SPARKLE_PRIVATE_KEY` y `WINDOWS_UPDATE_PRIVATE_KEY` viven únicamente en el entorno `release`. Sus copias de alcance repositorio se eliminan después de que el humano confirme la carga de los valores originales en el entorno.
2. El entorno exige aprobación de `sgiambelluca` y admite la rama `main` y tags `v*`. Se permite la aprobación del propio autor porque el proyecto tiene una sola persona. Esto añade una confirmación consciente; no equivale a una revisión independiente.
3. Tanto el job que utiliza las claves como el que crea el borrador declaran el entorno. Proteger solamente la publicación dejaría expuesto el uso previo de las claves.
4. Una validación sin secretos comprueba el evento, la pertenencia del commit a `main`, una ejecución exitosa de CI sobre ese SHA y, para tags, la coincidencia con la versión del paquete de escritorio. La ejecución manual solo se permite desde `main`.
5. El token tiene lectura de contenido por defecto. La consulta de CI obtiene lectura de Actions; únicamente el job de publicación obtiene escritura de contenido, OIDC y atestaciones. Checkout no persiste credenciales.
6. Las actions se fijan a SHAs completos. Dependabot propone actualizaciones semanales de actions mediante PR; ninguna actualización se integra automáticamente.
7. Antes de calcular hashes y subir assets se normalizan los espacios de sus nombres a puntos, como ya hace GitHub. No se modifican los manifiestos firmados ni los bytes de los instaladores. Se rechazan colisiones de nombres. El manifest de hashes excluye su propio archivo.
8. `main` exige PR, CI existente con trabajo real, rama actualizada y conversaciones resueltas. Se bloquean borrado y force-push, también para el administrador. No se exige una aprobación de PR de otra persona mientras el autor trabaje solo. Los jobs de perf/leak/cancel/stress pendientes no se presentan como garantías.
9. Las etiquetas de versión se protegen contra modificación y borrado. El mantenimiento excepcional del historial requiere una ventana explícita, con release pausado, respaldo privado, comparación de referencias y reposición de las protecciones.
10. Las publicaciones siguen siendo borradores hasta la revisión humana. Una pre-release no se convierte en estable para ocultar un 404 de `releases/latest`: el canal estable requiere una versión validada para ese canal.

## Alcance y límites

Este ADR no cambia contratos del Core, detección, exportación, actualizadores ni formatos de firma. Tampoco garantiza ausencia de nombres personales: el escaneo de secretos busca credenciales, y la higiene documental requiere revisión específica.

La reescritura de Git cambia hashes de commits y puede invalidar firmas de commits históricos. Los instaladores anteriores conservan sus bytes y firmas; sus atestaciones siguen referidas al commit original de construcción. No se recrean atestaciones para simular que esos binarios provienen del historial saneado.

Los valores originales, reglas privadas de sustitución, backups y comandos de soporte con referencias sensibles quedan fuera del repositorio. GitHub puede conservar referencias de PR y vistas cacheadas que requieren soporte. Las copias que ya descargaron terceros requieren coordinación humana.

## Validación

- Validación estática de workflows y de SHAs fijados.
- Pruebas del normalizador/hash con nombres con espacios, colisiones y repetición de la operación.
- Comparación del árbol saneado: sin modificaciones del runtime por la limpieza.
- Lectura de las configuraciones efectivas por API; guardar evidencia privada.
- Confirmación de los dos secrets por nombre y prueba manual del workflow desde `main`, con aprobación del entorno, tras publicar el cambio.
- Mantener el workflow de release pausado mientras no se cumplan esas precondiciones.

## Referencias

- [Entornos y aprobaciones](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- [Eliminación de datos sensibles del historial](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
- `RELEASING.md` — operación y comprobaciones de una publicación.
