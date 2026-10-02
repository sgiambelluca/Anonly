<!-- CONTEXT: scope=roadmap-plan | tarea=T-7 | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-080-Idle-Dispose-En-El-Pool-No-En-El-Manager.md,adr/ADR-157-El-Pool-De-OCR-Se-Da-De-Baja-Al-Terminar-Su-Etapa.md,adr/ADR-155-El-Arnes-De-Medicion-Configura-El-Core-Por-Un-Canal-Propio.md,architecture/07_Performance_Strategy.md,tests/perf/README.md | audiencia=planificador+implementador+humano | fase=11 -->

# T-7 — De qué está hecha la línea de base caliente

**Es una medición, no un cambio.** No toca `packages/` ni `apps/`: todo el
trabajo vive en `tests/`. No decide ninguna optimización — entrega la atribución
que hoy falta para poder elegir un lever, que es lo que ADR-154 §5 exige antes
de tocar nada.

## 1. La pregunta, y por qué importa

Con el instrumento arreglado, la primera tanda interpretable
(`Optimizacion_De_Memoria_Plan.md` §1bis) dejó esto:

| perfil | base fría | base caliente | base / M2 caliente |
| ------ | --------: | ------------: | -----------------: |
| P1 — 10 p de texto | 429,5 MB | **1723,9 MB** | **100 %** |
| P2 — 50 p escaneadas | 412,2 MB | **2158,1 MB** | **91 %** |

La aplicación arranca en ~420 MB y, después de abrir y cerrar **un** documento,
queda en 1,7–2,2 GB **sin documento abierto**. Procesar el siguiente cuesta
6,7 MB en P1 y 204,8 MB en P2 — o sea que el presupuesto de 512 MB se cumple
procesando, y lo que no entra es lo que quedó de antes.

Los componentes que `07_Performance_Strategy.md` §7.1 sabe nombrar suman ~1 GB
con Electron incluido. **Entre 700 MB y 1,2 GB no están atribuidos.**

De esa cifra depende qué lever corresponde: si la mayor parte se libera sola con
esperar, el trabajo es de ciclo de vida; si es piso irreducible de heaps WASM, es
otro problema y otro ADR.

## 2. La hipótesis principal, y es falsable

**La base caliente se mide antes de que el pool tenga oportunidad de liberar.**

- `HOT_BASELINE_SETTLE_CEILING_MS = 30_000` (`tests/perf/support/memoryProfile.ts`):
  la base caliente se toma como mucho a los **30 s** de `closeDocument()`.
- `idleDisposeMs: 60_000` (`packages/anonymization-core/src/config.ts:94`): el
  pool libera sus workers por inactividad a los **60 s** (ADR-080).

Si eso es así, **ninguna medición de la campaña vio nunca la liberación por
idle**, y la base caliente que venimos publicando describe un estado transitorio,
no el estado en reposo de la aplicación.

Predicción concreta: al muestrear más allá de los 60 s debe aparecer un
**escalón** hacia abajo. Si no aparece, la hipótesis es falsa y el piso es
estructural — resultado igual de publicable, y más importante.

> **No cambiar `HOT_BASELINE_SETTLE_CEILING_MS`.** La curva extendida es una
> observación **adicional**; `baselineBytes` conserva su definición actual o se
> rompe la comparabilidad con todo lo ya medido. Tampoco se toca `idleDisposeMs`:
> es configuración de producto.

## 3. Los tres cortes

### C-1 — La curva de liberación tras cerrar el documento

Después de `closeDocument()`, seguir muestreando **al menos 120 s** sin importar
nada nuevo. Registrar el RSS sumado y su desglose por proceso en, como mínimo,
**t = 5, 15, 30, 45, 60, 75, 90 y 120 s**.

Reporta: el valor en cada punto, el delta total entre t=5 s y t=120 s, y **si
hay un escalón, en qué instante ocurre**. Un escalón cerca de los 60 s es la
firma del idle-dispose; uno en otro momento pide explicación antes de
atribuirlo.

### C-2 — Atribución por proceso de lo que queda

Las muestras ya traen `perProcess` (Tab, GPU, Browser, Utility). Desglosar **la
base caliente**, no solo el pico, en cada punto de la curva de C-1.

Reporta: cuánto de la base vive en cada proceso al principio y al final de la
ventana, y cuál de ellos produce el escalón si lo hay. Un piso que viva en GPU
no se ataca igual que uno del renderer.

### C-3 — Cuánto es el modelo de NER

Comparar la base caliente con NER activo contra NER apagado. **Ya existe el
precedente**: `tests/perf/memory-attribution.spec.ts` tiene el caso "P2-attrib —
NER apagado" usando `installSettingsOverride` con `nerEnabled: false`, por el
canal de overrides de ADR-155 — sin tocar producción.

Reporta: el delta de base caliente entre las dos condiciones, y cómo se reparte
por proceso. Separa el modelo residente del resto del piso.

## 4. Protocolo

- **Perfiles**: P2 (`p2-scanned-50p`) como principal y **P1 como control**. P1
  importa: su base caliente es el 100 % de M2, así que es el caso más limpio para
  ver el piso sin que el documento lo tape. No hace falta P2-dense acá.
- **Tres corridas por condición**, seriales, `workers: 1`, `retries: 0`, sobre el
  shell de Electron empaquetado, cada una en instancia fresca.
- **C-3 se corre alternando** condición por corrida (on/off/on/off…), no en
  bloques: es la única forma de que la deriva del banco afecte a las dos por
  igual.
- **La presión de memoria del sistema se registra** en cada reporte
  (`systemPressureAtStart`/`AtEnd`, ya existe). Una comparación entre corridas de
  distinta sesión no es válida sin ese dato.
- Evidencia cruda, logs y manifiesto bajo `.measure/base-caliente/<timestamp>/`,
  sin sobrescribir tandas previas.

## 5. Criterio de cierre

T-7 cierra cuando el informe conteste, con sus tres corridas por condición:

1. **Qué fracción de la base caliente es recuperable esperando** y en qué
   instante se recupera.
2. **Dónde vive la fracción que no se recupera**, por proceso.
3. **Cuánto de ese piso es el modelo de NER** y cuánto es el resto.

Y que diga explícitamente qué parte del hueco de 700 MB–1,2 GB queda **sin
atribuir** después de los tres cortes. Un residuo sin explicar es un resultado
válido; presentarlo como si estuviera cubierto, no.

**T-7 no recomienda ni implementa una optimización.** Elegir un lever a partir de
esta atribución es una decisión posterior, del humano, con su propio ADR
(ADR-154 §1 y §5).

## 6. Límites que se declaran de entrada

- El fixture no es un escaneo real y **P4 sigue sin existir**
  (`Optimizacion_De_Memoria_Plan.md` §4). Eso acota a qué se parece P2, no la
  validez de la atribución del piso.
- M2 se mueve con la presión de memoria del sistema
  (`Instrumento_De_Memoria_Arreglo_Plan.md` §1): las comparaciones válidas son
  dentro de la misma sesión y con la presión registrada. **No comparar contra
  tandas anteriores al 2026-09-17**, que no la traen.
- La máquina de medición tiene un piso de carga propio y no puede quedar en
  silencio. Registrar las condiciones, no pretender eliminarlas.

## 7. Entrega al implementador

Leer, en orden: este plan, `Optimizacion_De_Memoria_Plan.md` §1bis y T-7,
ADR-146 (§1, §5, §7, §7bis, §7ter), ADR-080, ADR-155, `tests/perf/README.md`,
`docs/ai/Code_Standards.md` y `docs/ai/AI_Development_Guide.md`.

El arnés vive en `tests/perf/`. **No se toca `packages/` ni `apps/`**, no se
cambia `idleDisposeMs` ni `HOT_BASELINE_SETTLE_CEILING_MS`, y no se hace `git
commit` ni `push` sin autorización del humano (I-9). Gates antes de entregar:
`pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`, más Prettier y
`git diff --check`.

Si el plan no cubre un caso, dos documentos se contradicen o algo referenciado no
existe: **parar y reportar** con archivo, sección, cita y pregunta concreta
(`ai/AI_Development_Guide.md` §5). No improvisar.
