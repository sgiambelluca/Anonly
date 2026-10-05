# ADR-200: Vitest 4 para corregir las alertas de Dependabot

**Estado:** Aceptado — 2026-10-04.

## Contexto

Las 16 alertas abiertas de Dependabot (#52–#67) corresponden a
GHSA-82fw-gwwq-j7x9: Vitest y `@vitest/mocker` anteriores a 4.1.11 pueden
leer archivos fuera de la lista permitida cuando un redirect mock recibe una
ruta no autorizada. Las alertas se repiten por los manifests y por el lockfile.

La corrección existe desde 4.1.11; el aviso indica que la serie 3.x no recibirá
el parche. Actualizar solo el override raíz dejaría rangos vulnerables en los
manifests que Dependabot analiza por separado.

## Decisión

1. Actualizar las declaraciones de `vitest`, los overrides centrales y
   `@vitest/coverage-v8` a la misma serie corregida, desde 4.1.11, y regenerar
   `pnpm-lock.yaml`. No agregar dependencias directas nuevas.
2. Mantener Vite 6 y Node 22: son compatibles con Vitest 4. Las versiones de
   la app y sus contratos públicos no cambian por una actualización de tooling.
3. Adaptar únicamente la configuración y los mocks que lo necesiten según
   la guía de migración. Mantener los mismos thresholds y globs de cobertura;
   no reducir gates para conseguir una corrida verde.
4. Validar resolución de dependencias, ausencia del aviso en el audit, lint,
   typecheck, suites existentes, cobertura, build y CI del PR hacia `main`.
5. El trabajo es una campaña de mantenimiento del tooling de tests. Los
   cambios de manifests de cada motor se registran en commits separados; la
   configuración común y el lockfile se registran como tooling compartido.

La adaptación de mocks limpia explícitamente el historial entre operaciones
independientes de un mismo test: Vitest 4 reutiliza el mock existente al llamar
`spyOn`. Las expectativas y el código de producción permanecen iguales.
Los helpers de Grouping y Render tipan el spy con la firma de
`EngineContext.bus.emit`.

El audit también detectó GHSA-hrr3-gc8f-f4qj, moderado, en `fast-uri` 3.1.7.
Se actualiza su override a partir de 3.1.8, dentro de la misma versión mayor.

El fake de workers del Orchestrator usa mocks tipados con las firmas de
`WorkerLike`; su arnés OCR valida el mensaje desconocido antes de consumirlo.
La medición AST de cobertura de Vitest 4 deja Export bajo el threshold de
branches con la suite anterior. Se amplían los casos existentes de errores
deserializados y respuestas inválidas de `save` para validar esas rutas sin
reducir el threshold ni modificar producción.

Las dos alertas altas detectadas por `pnpm audit` sobre `braces` y
`http-cache-semantics` son avisos distintos y no forman parte de las 16 alertas
de Dependabot. Esta actualización no los oculta ni desactiva el audit.

## Referencias

- [Aviso de seguridad](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).
- [Aviso de fast-uri](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
- [Guía de migración de Vitest 4.1.11](https://github.com/vitest-dev/vitest/blob/v4.1.11/docs/guide/migration.md).
- ADR-124: alcance y trazabilidad de los commits de una campaña.
