# ADR-201: corregir el audit y verificar el parche local de braces

**Estado:** Aceptado — 2026-10-05.

## Contexto

El PR de seguridad corrige las 16 alertas de Vitest (ADR-200), pero el audit
encuentra dos avisos altos adicionales: GHSA-ch52-4w7c-c8xp en
`http-cache-semantics@4.2.0` y GHSA-vfj7-8cjw-p6xm en `braces@3.0.3`.

El primero llega por `electron-builder > app-builder-lib > @electron/get@3`.
El mantenedor de http-cache-semantics disputa el reporte. La versión 4.3.0
publicada el 4 de octubre no cambia la rama max-stale señalada: actualizar
solo para salir del rango del advisory no demostraría una corrección.

Braces no tiene una versión corregida publicada. El PR upstream #72 propone
limitar la profundidad a 100 en el parser y los walkers, y rechazar ciclos de
parents. pnpm audit consulta versiones del registry, no los archivos que pnpm
modifica mediante patchedDependencies. Un parche aplicado sigue reportándose
con la versión original.

## Decisión

1. Actualizar solo `app-builder-lib > @electron/get` a 5.1.0. Esa versión ya
   está en el lockfile por Electron y elimina got/cacheable-request y
   http-cache-semantics de esta cadena. Verificar su API CommonJS en Node 22
   y un empaquetado local sin publicar ni firmar releases.
2. Aplicar con pnpm un parche de los cinco archivos lib de braces 3.0.3 basado
   en el PR #72, fijado al commit
   `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, aplicando únicamente los
   cambios de profundidad y ciclos sobre 3.0.3, sin los cambios previos del
   fork sobre comillas y bloques inválidos. Conservar versión y licencia
   originales; no presentar una versión local como release oficial.
3. Verificar el hash del parche, los hashes de los archivos instalados, la
   resolución de todos sus consumidores y las regresiones de profundidad y
   ciclos, junto con patrones válidos. No basta con confiar en la metadata.
4. El gate Security audit conserva su nombre y consulta el audit completo.
   Solo el advisory exacto de braces 3.0.3 se considera corregido si todas las
   verificaciones locales pasan. Cualquier otra versión, aviso alto/crítico,
   falta de parche, hash distinto o regresión fallida bloquea. No agregar
   ignoreCves global ni cambiar protecciones de branches.
5. Agregar yaml como dependencia directa de desarrollo del tooling para leer
   el lockfile de forma estructurada. Ya existe como dependencia transitiva;
   no entra al Core ni a la app empaquetada. La excepción y su verificador
   deben retirarse juntos cuando upstream publique una versión corregida.
6. Completar el PR de seguridad antes de rebasar y validar el PR de docs
   sobre main actualizado. Merge por rebase únicamente con CI verde.

## Validación

La prueba local con 4.500 llaves anidadas (9.001 caracteres) reproduce
`Maximum call stack size exceeded` en compile, expand y stringify de 3.0.3
original; el parche rechaza la profundidad 101 con `exceeds max depth`.
Los tests verifican rechazo acotado, incluso para ASTs externos. Los
tests del gate cubren el aviso conocido corregido, otros avisos, versión
distinta y evidencia inválida. Se ejecutan los gates existentes, build,
empaquetado local y CI remoto sin reducir thresholds.

## Referencias

- [Advisory de braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- [Parche upstream propuesto](https://github.com/micromatch/braces/pull/72).
- [Reporte y respuesta del mantenedor de http-cache-semantics](https://github.com/kornelski/http-cache-semantics/issues/56).
- ADR-124 y ADR-200.
