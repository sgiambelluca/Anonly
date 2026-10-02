<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,ai/AI_Development_Guide.md,ai/Code_Standards.md,adr/ADR-010-Testing-Strategy.md,adr/ADR-033-Test-Infra-Global-Scripts-Alias.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md | audiencia=humanos+IA | fase=11 -->

# ADR-149 — Un gate que no ejecuta nada es rojo

- **Estado**: Accepted
- **Fecha**: 2026-09-09
- **Decidido por**: El planificador, sobre H-07 del plan de campaña de hardening (§9).
- **Relacionado con**: `07_Performance_Strategy.md` §11.4 (la tabla canónica), ADR-146 (los presupuestos que Performance/Stress necesitan), ADR-147 (la baseline de detección), ADR-033 (filtro posicional en los scripts de Vitest)
- **Parte de**: Hito 11 — Hardening

## Contexto

### 1. Cuatro jobs que pasan sin ejecutar nada

`.github/workflows/ci.yml` tiene, para `test-perf`, `test-leak`, `test-cancel` y
`test-stress`, el mismo patrón:

```yaml
- name: Check if perf tests exist
  run: |
    if [ -d "tests/perf" ] && [ -n "$(find tests/perf -name '*.test.ts' …)" ]; then
      echo "has_tests=true" …
    else
      echo "has_tests=false" …
      echo "No perf tests found, skipping."
- name: Run perf tests
  if: steps.check_perf.outputs.has_tests == 'true'
```

Los cuatro directorios **no existen**. Los cuatro jobs salen en verde.

La activación diferida está documentada ("auto-activa al existir `tests/perf/`",
§11.4) y en su momento fue una decisión razonable. El problema de producto es
otro: un check verde llamado "Performance", "Memory leak", "Cancellation SLA" o
"Stress" **no** significa hoy que se haya medido rendimiento, memoria, SLA de
cancelación ni estrés. Significa que no hay archivos.

Hay otros tests unitarios y E2E que ejercitan el flujo. No hay que confundirlos
con la medición de estas cuatro propiedades, que no existe.

## Decisión

**La ausencia de pruebas obligatorias es un fallo, no un salteo.**

### 1. Cada gate ejecuta o falla

Se retira el patrón "existe el directorio → corre; si no, verde". Cada uno de
los cuatro comandos:

- falla con código distinto de cero si **no encuentra** su conjunto mínimo;
- comprueba además que el runner **descubrió y ejecutó** ese mínimo. Una carpeta
  con todos los tests salteados no cumple: `skipped` no es `passed`.

Se quitan los `continue-on-error`, los `|| true` y los salteos que oculten el
resultado **de estos cuatro jobs**. Otros jobs no se tocan en el mismo cambio.

### 2. Cada gate tiene un control que demuestra que puede fallar

Por cada propiedad, además del test, un control discriminante: una situación
donde la propiedad **no** se cumple y el gate tiene que ponerse rojo. Un gate que
nadie vio fallar nunca no es un gate. Nada de `expect(true).toBe(true)`.

### 3. Qué mide cada uno

- **Performance**: eventos reales de inicio y fin sobre documentos sintéticos,
  con el hardware descrito. Frío y caliente son escenarios **separados**
  (ADR-146 §4).
- **Leak**: diez ciclos abrir/procesar/cerrar, midiendo **después** de liberar,
  distinguiendo modelos retenidos por idle (ADR-080, legítimo) de referencias a
  documentos que nunca se sueltan (fuga).
- **Cancel**: desde la solicitud hasta el **cese efectivo del trabajo** de cada
  motor, con el SLA contractual de **200 ms**. Un cambio de estado en la UI o un
  `PIPELINE_CANCELLED` emitido **no** demuestran que la CPU paró. El SLA no se
  amplía para acomodar una implementación que no cancela.
- **Stress**: el escaneo sintético de H-10 y documentos nativos grandes, con
  watchdog, presupuesto y verificación de **salida completa** — menos memoria
  por saltear páginas no es una mejora. El fixture de 1000 páginas sirve para
  cancelación sin exigir OCR completo de 1000 páginas en cada PR.

### 4. El runner se elige por propiedad

Vitest/Node sirve para el control determinista de colas y cancelación lógica. El
consumo real de Electron, OCR y WASM exige el runtime real. Si se incorpora un
runner nuevo, primero se documentan comando, configuración y CI, y recién
después se lo llama desde un script.

Los scripts de Vitest conservan el **filtro posicional** y nunca `--dir`
(ADR-033). Un test global que importe un motor por primera vez agrega
`resolve.alias` en `vitest.config.ts` y el `paths` espejo en `tests/tsconfig.json`
**en el mismo PR**.

### 5. Los números salen de otro lado

Este ADR decide **que** los gates ejecuten y fallen, no **con qué umbral**.
Performance y Stress toman sus presupuestos de ADR-146 (que primero exige
medir); Cancel toma los 200 ms, que ya son contractuales. Activar un límite que
todavía no se midió produciría un rojo permanente que termina desactivando el
gate: exactamente de dónde venimos.

### 6. §11.4 es la única tabla

El estado y el comando de cada gate se editan **solo** en
`07_Performance_Strategy.md` §11.4, y el workflow la implementa. Ningún otro
documento repite la lista; la referencian.

### 7. Se prueba el cambio de CI

En un entorno controlado: suite ausente y resultado con regresión. En los dos
casos el job tiene que quedar rojo, y el check tiene que ser de los exigidos por
la protección de rama.

## Consecuencias

**A favor**

- Cuatro checks dejan de afirmar algo que no midieron. La confianza falsa es
  peor que la ausencia declarada de un gate.
- Cada propiedad queda con un test **y** con la prueba de que ese test puede
  fallar.
- La tabla §11.4 vuelve a describir la realidad del workflow.

**En contra**

- **CI se pone rojo el día que esto entra**, hasta que los cuatro conjuntos
  existan. El orden de la campaña lo contempla: primero se escriben las pruebas
  y sus controles, y el cambio del workflow va al final, en su propio commit.
- CI se vuelve más lento y más frágil: medir memoria y tiempo en un runner
  compartido tiene ruido. De ahí que los umbrales salgan de la caracterización
  de ADR-146 y no de una corrida única.
- Un gate que falla por infraestructura (runner sin memoria, asset ausente) es
  indistinguible a primera vista de una regresión. Cada uno reporta la causa
  —"no cumple" contra "inconcluso"— para que esa distinción no dependa de leer
  el log entero.

**Lo que no toca**: los demás jobs del workflow, el código de producción, ni
`Contracts.md`.
