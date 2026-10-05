<!-- CONTEXT: scope=adr-cierre-adr148 | dependencias=adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,core/PDF_Engine.md,roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/mediciones/ocr/Regiones_Pequenas_25pt_2026-10-05.md | audiencia=humanos+IA | fase=12 -->

# ADR-203 — El gate de export cubre la política OCR vigente

- **Estado:** implementación y validación local APPROVED; 21/21 y R-16 verdes;
  CI/macOS pendiente de ejecución sobre el cambio publicado.
- **Fecha:** 2026-10-05.
- **Decidido por:** el planificador, al resolver la instrucción humana de
  cerrar el criterio pendiente y buscar verde en todas las partes de ADR-148.
- **Alcance:** corrección explícita del corpus de tests y retiro del
  prototipo de 25 pt del runtime de trabajo. No adopta una nueva política OCR.

## Contexto

ADR-148 agrega infraestructura que verifica el PDF exportado. El plan
original pidió detección automática en una imagen mixta de 300 × 56 pt,
incompatible con los dos lados de 100 pt exigidos por ADR-065. Ese error
del plan produjo 20/21 en la primera corrida completa Windows.

La investigación ADR-202 recuperó ese DNI con un mínimo experimental de
25 pt, pero refutó la condición de no activar OCR nuevo en capas alineadas.
Sol aprobó el arnés y la evidencia; no la adopción del candidato. Su costo
real no se midió. El éxito del gate no debe implicar adoptar ese experimento.

## Decisión

1. Restaurar en el workspace `OCR_REGION_MIN_SIDE_PT = 100`, retirando los
   comentarios de candidato activo. No modificar otros filtros, motores,
   contratos, modelos, DPI ni paralelismo. Los snapshots y resultados de
   25 pt se conservan como evidencia histórica inmutable.
2. Versionar el mixed del gate como **`mixed-eligible-v2-300x125`**: imagen
   de 300 × 125 pt en `x=40`, `y=220` de la página A4 595 × 842 pt.
   El PDF fuente de la imagen tiene exactamente esas dimensiones y se
   rasteriza con el mismo scale 4. Helvetica 18 pt, texto en `x=8`, `y=18`,
   DNI y vecino idénticos. No escalar ni agrandar los glifos para mejorar
   lectura. El texto nativo y sus diez líneas permanecen como antes.
   La nueva caja queda separada de los bboxes nativos y vecinos.
3. Conservar el generador original como **`mixed-small-v1-300x56`** para
   caracterización: misma imagen 300 × 56, `x=40`, `y=248`, fuente 18 y
   posiciones originales. Exponer desde soporte de tests un builder
   separado para esa variante. Los tres arneses de investigación deben
   seguir usando la pequeña; no cambiar por accidente sus corpus o auditorías.
   Ningún artefacto histórico se sobrescribe o pasa a acreditar la variante v2.
4. El mixed del gate sigue exigiendo detección real de ambos DNI,
   `OCR_PAGE_FINISHED`, export real UI y oráculo completo. No convertirlo
   en un test solo de geometría, inyectar entidades, aflojar fragmentos,
   saltear filas ni bajar el mínimo de 21.
5. Registrar `corpusRevision` en el descriptor/manifiesto y evidencia de
   mixed. Afirmar capa textual nativo presente/imagen ausente, identidad de
   variante y separación geométrica. El caso pequeño sigue siendo una
   limitación conocida: puede exportar el dato rasterizado con la política
   vigente. No declarar que ese problema de producto quedó arreglado.
6. Sustituir las dos pruebas unitarias de candidato activo por fronteras
   normativas de **100/99,99 pt en ambos ejes**, y una regresión que confirme
   exclusión de 300 × 56 pt bajo la referencia. Sus nombres están en §14 del
   spec PDF actualizado por el planificador antes de implementación.
7. Luna corre scoped checks y **una corrida completa** del comando dedicado
   `pnpm test:export-verification` sobre el runtime restaurado. Sol revisa
   por lote, confirma los cinco gates R-16 del repo completo y las pruebas
   PDF afectadas; no repite mediciones ni suites pesadas por rutina. Una
   falla se corrige y se repite solo el alcance necesario, conservando evidencia.
8. El gate agrega `playwright.export-verification.config.ts` a la lista
   explícita `allowDefaultProject` de ESLint. Si el lint global confirma
   20 archivos, actualizar el límite de 19 a **20**, sin ensanchar globs,
   excluir configs ni desactivar reglas/type-aware lint. Es capacidad para
   el nuevo config del gate, no una excepción a sus checks.

## CI y cierre

El job `Export verification` en macOS ejecuta el gate dedicado y conserva
evidencia sintética aun al fallar. El agregador `E2E (Playwright)` exige
su éxito. Conserva el filtro ADR-199: pushes a main/develop, PR hacia main
y dispatch; no añade este costo a cada PR hacia develop.

La revisión de wiring no acredita una ejecución macOS. Los cambios están
sin publicar: un dispatch sobre un ref remoto existente no prueba este
working tree. Preparar código, gates locales, revisión y docs antes de
solicitar autorización explícita de commit/push si la ejecución remota la
requiere (I-9). No declarar CI verde sin resultado del ref que contiene el cambio.

El cierre local exige 21/21, cero salteados, controles con causa esperada,
oráculo completo, R-16 verde, revisión APPROVED y documentación sincronizada.
El cierre remoto se registra aparte con run/ref y evidencia. Sin cambios
de protección remota, release ni publicación de política OCR nueva.

## Consecuencias

**Resultado local:** Luna implementó la separación versionada y restauró
exactamente el source de referencia de 100 pt. Gate completo Windows 21/21,
cero fallos/salteados. Sol auditó evidencia/hashes, cobertura normativa y
los cinco gates R-16; cerró el único P2 de lint con capacidad 20 y dio
APPROVED. Ver [el cierre documentado](../roadmap/hardening/ADR148_Cierre_ADR203_2026-10-05.md).
La corrida remota está pendiente. El humano autorizó crear commits y hacer
push en develop para acumular los cambios y ejecutar CI sobre ese HEAD.

Se corrige una contradicción del plan, no un defecto del wiring de OCR.
La revisión de corpus fue decidida antes de código; el implementador no
facilita fixtures para ocultar rojos. El dato sensible de la variante
pequeña permanece como trabajo de producto separado. ADR-148 acredita una
matriz acotada de export; no promete recuperación de toda imagen ni reemplaza
la verificación visual manual.
