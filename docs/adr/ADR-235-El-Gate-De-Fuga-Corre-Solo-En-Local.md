<!-- CONTEXT: scope=adr | dependencias=adr/ADR-185-Gates-De-Leak-Y-Stress-En-Electron.md,adr/ADR-149-Un-Gate-Que-No-Ejecuta-Nada-Es-Rojo.md,architecture/07_Performance_Strategy.md,RELEASING.md,roadmap/Roadmap_1.x.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-235 — El gate de fuga corre solo en local

- **Estado**: Aceptado por el mantenedor el 2026-11-22.
- **Fecha**: 2026-11-22.
- **Decidido por**: el mantenedor, durante la publicación de la 1.1.0.
- **Modifica**: ADR-185 §5 (enmiendas del 2026-10-01 y del 2026-10-02): el
  gate `test:leak` deja de correr en CI.
- **Alcance**: `.github/workflows/ci.yml` y la documentación de gates. Sin
  cambio de producto, contrato, dependencias ni del protocolo de medición.

## Contexto

Desde ADR-185, `test:leak` corre en CI al mergear a `main` y cuando se lo
lanza a mano. Sus tres casos corren en paralelo, uno por runner de macOS, así
que el check dura lo que dura el caso más largo:

- **L3**, el régimen con reposo, espera de 80 a 90 s después de cada uno de
  sus 11 ciclos para ver que los pools ociosos se liberen. El pool general se
  da de baja a los 60 s. Solo las esperas suman unos 15 minutos.
- **L2** hace once veces el OCR de un escaneado de 50 páginas.

En la 1.0.2 tardaron 13 minutos (L2) y 18 (L3). La validación de
`release.yml` exige CI exitosa de push en `main` para el commit del tag, así
que cada release espera ese tiempo después de promover `develop`.

El check «Memory leak» no es requerido en la protección de `main` ni de
`develop`: no frena merges, pero sí el tag.

El mantenedor considera poco probable que un cambio introduzca una fuga de
este tipo, y que el costo de esperar no se justifica en cada release.

## Decisión

1. Se quitan de `ci.yml` los jobs `test-leak-case` (L1, L2 y L3) y
   `test-leak` (el agregador «Memory leak»). El check deja de existir en CI.
2. `pnpm test:leak` no cambia: mismos tres casos, mismo veredicto
   (`workersGrow` y `heapGrows`, ADR-185 §2 y su enmienda del 2026-10-02) y
   mismo reporte en `.measure/leak/`.
3. Se corre **en local**, como parte de la suite pesada que
   `Roadmap_1.x.md` §2 pide antes de una versión menor, y cuando un cambio
   toca la liberación de recursos: cierre de documento, pools de workers,
   temporizadores de baja, blob URLs o caches del Core.
4. ADR-149 §1 sigue rigiendo la corrida local: sin specs o con tests
   salteados, el resultado no cuenta como verde.
5. `test:stress` no cambia: sigue en CI al mergear a `main` y a mano.

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Acortar los temporizadores de baja solo en el build de test | Baja L3 a unos 4 minutos, pero L2 sigue en unos 13 y el tag igual lo espera |
| Correr el leak en el PR de `develop` a `main` | La espera se solapa con probar los instaladores, pero sigue siendo media hora de runners de macOS por release |
| Menos ciclos | Con menos puntos, la pendiente del heap detecta peor una fuga lenta |

## Consecuencias

- La CI de `main` termina en lo que tarda Stress, unos 11 minutos, y el tag
  se puede poner antes.
- Una fuga de workers o de heap ya no se detecta sola al mergear: depende de
  que alguien corra `pnpm test:leak` en local. Es el costo aceptado.
- El Escenario 7 de E2E sigue cubriendo en cada PR el flujo de abrir y cerrar
  diez documentos y la limpieza observable (ADR-048 §3, ADR-052), sin medir
  bytes.
