<!-- CONTEXT: scope=preparacion-release-1.0.2 | dependencias=RELEASING.md,roadmap/Roadmap_1.x.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/hardening/Export_Verification_CI_2026-10-11.md,adr/ADR-209-La-Promocion-A-Main-Usa-Merge-Commit.md,adr/ADR-216-Las-Novedades-De-Cada-Version-Viajan-Con-La-Aplicacion.md | audiencia=humanos+IA | fase=1.0.2 -->

# Preparación de 1.0.2 — 2026-10-12

## Solicitud y alcance

El mantenedor solicitó abrir el PR de `develop` hacia `main` para preparar
la release **1.0.2**. El número reemplaza la falta de asignación del cierre
de Confianza. Se incluyen los cambios acumulados de detección, OCR, visor,
exportación, interacción y avisos/novedades. La excepción humana que incluye
«Novedades» en un parche ya está documentada en Roadmap §2ter.

Se mantiene el flujo Sol → Luna → Sol y la autorización previa de commits,
push y PR. La rama de preparación se integra primero en develop siguiendo
RELEASING.md. El resultado solicitado es el PR de promoción, abierto para
revisión; esta tarea no ejecuta su merge a main ni crea tag o publicación.

## Precheck de Sol

**APPROVED para preparar la versión y abrir la promoción**, sin equivaler
a aprobación del release. Base `origin/develop`:
`68718399d661b6e427a710459a494808b46cacb4`, con CI de push y CodeQL verdes.
Los tres changesets son patch. Changesets prevé **1.0.2 en los trece
paquetes @anonly**, mientras la raíz permanece en `0.0.0`.

La promoción directa no tiene conflictos. El árbol de `merge-tree` coincide
con el de develop: la divergencia histórica de SHAs no exige trasladar
cambios adicionales ni una rama intermedia. Esto se comprueba de nuevo
cuando la preparación llegue a develop.

## Plan para Luna

Rama `codex/release-1.0.2`, desde origin/develop. Solo preparación de versión:

1. Ejecutar `pnpm run version`, consumir los tres changesets y verificar los
   trece números, CHANGELOG y dependencias internas. No cambiar versiones de
   dependencias externas ni herramientas.
2. Agregar primera entrada en `releaseNotes.ts`, versión `1.0.2`, fecha prevista
   `2026-10-12`, conservando las entradas anteriores. Tres textos para el
   usuario, de hasta 140 caracteres, con estos contenidos:
   - Nuevo: «Ahora podés consultar las novedades de cada versión y ver qué texto
     queda visible antes de eliminar una entidad.»
   - Arreglo: «Mejora la detección de direcciones y emails; el mismo documento
     puede dar otro resultado.»
   - Arreglo: «Las etiquetas largas conservan la letra del renglón y la búsqueda
     sigue el texto visible en el PDF anonimizado.»
3. Validar los tests existentes de novedades, lint/tipos/formato focalizados
   y diff-check. Sol revisa después el lote y ejecuta R-16 global una vez.
   No se agregan tests que solo dupliquen estos textos ni se cambia producto,
   motores, umbrales o fixtures.
4. No editar docs, commitear ni pushear. Los CHANGELOG generados por Changesets
   son parte de la salida autorizada del comando. El planificador prepara
   commits por módulo para preservar R-1, y un commit separado para el consumo
   de changesets y cualquier lockfile generado.

## Entrega local para revisión

Luna aplicó Changesets: 13/13 paquetes en 1.0.2, raíz en 0.0.0, trece
CHANGELOG con la entrada nueva y cero changesets pendientes. No cambió
dependencias internas/externas ni el lockfile. Las novedades tienen 112,
89 y 111 caracteres y conservan las entradas 1.0.1/1.0.0.

Los diez tests de novedades, ESLint, typecheck y Prettier focalizados en
React Client, y diff-check pasaron. **Sol APPROVED para publicar la
preparación:** ejecutó personalmente lint, typecheck, 4413 tests verdes
(un fallo esperado y 77 omitidos), 347/347 contratos, formato y diff-check.
Los 33 archivos publicables no contienen datos sensibles detectados.
La partición aprobada son quince commits: trece módulos, documentación
y consumo de changesets. La integración de esta preparación se condiciona
al CI verde; la aprobación no incluye el release ni el merge a main.

## Validaciones y límites antes del tag

Abrir la promoción no declara completa la validación del release. En el PR
quedan visibles estos requisitos:

- Repetir sobre commit las campañas provisionales **RC aislado, M-O1 y M-D3**
  según sus protocolos. No repetir toda la investigación ni el flujo M-V1
  de «Validar muestra», cancelado. No convertir resultados provisionales
  en finales mediante cambios de documentación.
- Gates y suite pesada requerida por los cambios de motores. Leak y Stress
  se validan en main o mediante la ejecución manual pertinente.
- Prueba de `release.yml`, firmas y smoke del binario empaquetado, con la
  aprobación del entorno protegido que corresponda.
- CI de push verde sobre el merge commit de main antes de crear `v1.0.2`.
- Corregir la fecha de novedades si la publicación se realiza otro día.

M2 final conserva su validez para el producto mientras esta preparación
solo cambie versiones, novedades y documentación. SV/CP sigue como único
desarrollo diferido del bloque de Confianza; «Validar muestra» permanece
retirada. Las notas completas de publicación deben conservar las limitaciones
OCR/export y el riesgo residual de orientación documentado.

## Promoción

Después de integrar la preparación en develop con historial lineal, abrir
**develop → main**. El método de integración requerido para ese PR es
**Create a merge commit**, para conservar los SHAs; no rebase, squash ni
merge de main hacia develop. Su merge y el tag quedan fuera de esta tarea.
