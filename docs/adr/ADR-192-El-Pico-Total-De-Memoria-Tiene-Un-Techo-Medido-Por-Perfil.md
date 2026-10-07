<!-- CONTEXT: scope=adr | dependencias=07_Performance_Strategy.md,00_Project_Vision.md,roadmap/MVP.md,roadmap/Version_1.0.md,roadmap/Future_Ideas.md,roadmap/memoria/H-10_Bitacora_De_Memoria.md,roadmap/mediciones/transversal/Banco_Windows_Comparativa_Medicion.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md | audiencia=humanos+IA | fase=11 -->

# ADR-192 — El pico total de memoria tiene un techo medido por perfil

- **Estado**: Aceptado. **Medido el 2026-10-01: P1 y P2 cumplen** (ver «Medición del 2026-10-01»), con un margen en P2 menor que el ruido.
- **Fecha**: 2026-09-30.
- **Decidido por**: el humano, a propuesta del planificador. Equipo mínimo:
  «8 GB de momento, con plan de poder optimizar a futuro aún más para
  extender la accesibilidad del producto». Techos de 2,0 GB y 3,0 GB:
  aprobados el mismo día.
- **Origen**: el ítem ABIERTO de `MVP.md` «presupuesto M2 de ADR-146 sin
  cumplir», que había que decidir antes del merge de
  `hardening/plan-2026-09`. ADR-154 §5 deja esa decisión en manos del
  humano cuando las palancas de memoria no alcanzan.
- **Enmienda**: ADR-146 §1 (el presupuesto de M2) y §6 (cómo se convierte
  en gate). M1 y todo lo demás de ADR-146 quedan como están.
- **Alcance**: documentación y procedimiento de release. No toca código de
  producto ni contratos.

## Contexto

ADR-146 separó dos métricas: **M1**, la memoria atribuible al documento, y
**M2**, el pico total del árbol de procesos, que responde a «¿entra en el
equipo del usuario?». Para M2 fijó ~1,6 GB con OCR y NER cargados.

Ese número tiene tres problemas:

1. **Nunca se midió.** Es la suma de estimaciones por componente de la
   fase 1 (`07_Performance_Strategy.md` §7.1), hechas antes de que
   existiera casi todo. La bitácora H-10 encontró que omitía un proceso
   entero, el de la GPU, que aporta 75–99 MB durante el OCR.
2. **Lo medido lo supera.** En el banco de Windows nativo
   (`Banco_Windows_Comparativa_Medicion.md` §4.3), el perfil P2 da 2204 MB
   en frío y 2763 MB en caliente. P1 da 1574 MB en frío y 1284 MB en
   caliente. ADR-190 sumó después +209,10 MiB de pico mediano en páginas
   escaneadas escasas, un costo que el humano aceptó.
3. **Las palancas baratas ya se usaron.** La campaña de memoria aplicó las
   de ADR-154 §2. Lo que queda (`Future_Ideas.md` §6) es caro, y ADR-154
   prohíbe cerrar la brecha bajando el paralelismo en silencio.

Mientras tanto no había ningún número contra el cual decir «esto empeoró»:
un presupuesto que se sabe incumplido no protege de nada.

## Decisión

### 1. El equipo mínimo soportado tiene 8 GB de RAM

Es un requisito de producto, y es la referencia contra la que se juzga M2.
Se declara en el `README.md`. Un equipo con menos memoria puede funcionar,
pero no está soportado: ningún presupuesto se calcula para él.

### 2. M2 tiene un techo por perfil de medición

Los perfiles son los de ADR-146 §4: escenarios de medición, no los perfiles
de rendimiento de la aplicación (§5). Los techos reemplazan los ~1,6 GB y
los ~870 MB de ADR-146 §1:

| Perfil (ADR-146 §4) | Medido (Windows nativo) | Techo de M2 |
|---|---|---|
| **P1**: 10 páginas con texto, NER | 1574 MB frío, 1284 MB caliente | **2,0 GB** |
| **P2**: 50 páginas escaneadas, OCR y NER | 2204 MB frío, 2763 MB caliente | **3,0 GB** |

- Unidades decimales, como en ADR-146 §2: 2,0 GB = 2.000.000.000 bytes.
- El techo vale para la corrida fría y para la caliente.
- Valen con la **configuración por defecto** de la aplicación.
- P3 (el ciclo de abrir y cerrar) no tiene techo de M2: lo que mide es el
  crecimiento entre ciclos, que gobierna el gate Leak (ADR-185).

**Por qué 3,0 GB entra en 8 GB.** Es una estimación, no una medición: si
el sistema operativo ocupa alrededor de 3 GB en reposo, con 3 GB de pico de
la aplicación quedan unos 2 GB para otras aplicaciones antes de que el
sistema recurra al swap. Y M2
es una cota superior: suma la memoria de cada proceso y cuenta más de una
vez las páginas compartidas (ADR-146 §3).

### 3. Es un techo absoluto, no un porcentaje sobre una línea de base

ADR-146 §7 midió un ruido de M2 de ~345 MB entre corridas iguales, cerca
del 15 % del valor de P2. Un gate de regresión del tipo «no más de un 10 %
sobre lo medido» fallaría por ruido. El criterio es el de ADR-146 §6, con
el número nuevo: tres corridas frías y tres calientes por perfil, y el
**máximo** contra el techo. Un OOM o una corrida abortada es «no cumple»;
un resultado no disponible es «inconcluso», nunca cero.

### 4. Dónde y cuándo se mide

- **Banco de referencia: Windows nativo.** El gate se evalúa ahí, porque es
  donde M2 da más alto en lo medido.
- **macOS es informativo.** Su RSS y el `workingSetSize` de Windows no
  cuentan lo mismo (`Banco_Windows_Comparativa_Medicion.md` §4.3), así que
  un número de macOS no se compara contra estos techos.
- **Antes de cada release, en local**, con la máquina sin otras mediciones,
  igual que el umbral de tiempo de 8 s (`07_Performance_Strategy.md`
  §11.4). El instrumento es `tests/perf/memory.spec.ts` con
  `--repeat-each=3`. Hoy mide y reporta sin afirmar umbrales, así que la
  comparación contra el techo la hace quien corre el release y la deja
  registrada. Automatizarla con una variable de entorno, como
  `ANONLY_PERF_ENFORCE_BUDGET` para el tiempo, queda como tarea posterior
  al merge.
- **CI no lo aplica**: corre en Linux y macOS.

**Medición pendiente.** Los valores de la tabla son anteriores a ADR-190.
Antes del merge hay que volver a medir P1 y P2 en Windows sobre el `HEAD`
de la branch:

- Si el máximo de P2 queda en 3,0 GB o menos, y el de P1 en 2,0 GB o menos,
  el ítem de `MVP.md` se cierra.
- Si alguno lo supera, la decisión vuelve al humano con el número real
  (ADR-154 §5). No se sube el techo ni se baja el paralelismo sin esa
  decisión.

### 5. Los perfiles de rendimiento amplían la tabla, no la reemplazan

Cuando la aplicación tenga perfiles de rendimiento (Bajo, Intermedio, Alto,
Automático), cada uno va a consumir distinto. El ADR que los defina amplía
esta tabla a dos ejes, perfil de medición por perfil de rendimiento, con un
techo explícito en cada celda (`MVP.md`, Hito 11: «un perfil podrá consumir
más memoria si la mejora de tiempo lo justifica, con presupuestos
explícitos»).

> **Hecho en ADR-194 §7 (2026-10-01).** Los perfiles son cinco (se sumó
> Ultra). Sus techos se fijaron sobre un escenario nuevo, un escaneo de 300
> dpi, medido con el arnés del pool: 3,5 GB provisorio en Bajo (**2,5 GB
> desde el 2026-10-07**, ya medido), 3,5 GB en Intermedio, 4,5 GB en Alto y
> 5,0 GB en Ultra. Los techos de §2 no cambian,
> y son los del nivel Intermedio: `memory.spec.ts` lo fija de forma explícita,
> porque Automático ya no da la misma configuración en todos los equipos.

### 6. Bajar la memoria sigue siendo un objetivo

El humano quiere extender el producto a equipos más chicos. Eso queda como
meta de la v1.0 (`Version_1.0.md` §3): bajar los techos de M2 y revisar el
equipo mínimo. Las palancas conocidas están en `Future_Ideas.md` §6. Este
ADR no las descarta: fija desde dónde se parte.

## Medición del 2026-10-01

Windows nativo (i5-12400, 12 hilos, 15,8 GB), sobre `ebd030d`, con
`tests/perf/memory.spec.ts --repeat-each=3`. Nueve corridas, todas `ok`.

| Perfil | M2 frío (MB) | M2 caliente (MB) | Máximo | Techo | Veredicto |
|---|---|---|---:|---:|---|
| P1 | 1582,5 / 1573,4 / 1596,8 | 1284,4 / 1280,9 / 1291,2 | 1596,8 MB | 2,0 GB | **cumple** |
| P2 | 2005,3 / 2031,6 / 1968,1 | 2660,9 / 2894,2 / 2705,3 | 2894,2 MB | 3,0 GB | **cumple** |
| P2-dense (informativo) | 2281,6 / 2080,0 / 2164,0 | 2620,3 / 2758,1 / 2691,3 | 2758,1 MB | sin techo | — |

Dos salvedades que quedan abiertas:

- **El margen de P2 es de 106 MB, menor que el ruido de M2** (~345 MB,
  ADR-146 §7). «Cumple» es el resultado de esta tanda; otra tanda sobre el
  mismo código puede dar «no cumple». Si pasa, la decisión vuelve al humano
  (§4), y no se sube el techo en silencio.
- **P2 no es el peor caso.** El fixture de P2 se rasteriza a 216 dpi. La
  tanda de perfiles del mismo día midió un corpus a 300 dpi nativos (`P2H`,
  20 páginas) con la configuración por defecto de dos reconocedores: 2928 MiB
  de mediana de pico de RSS durante el OCR, contra 2217 MiB de P2 en el mismo
  instrumento. Ese instrumento (`run-ocr-pool.sh`, RSS natural del árbol) no
  es el de este gate, así que el número no se compara contra el techo de
  3,0 GB. Lo que sí muestra es que un escaneo a 300 dpi consume del orden de
  700 MiB más que P2. Un perfil de medición a 300 dpi, con su techo, se
  define junto con los perfiles de rendimiento (§5).

## Consecuencias

**A favor**

- Hay un número honesto contra el cual detectar una regresión de memoria.
- El requisito de 8 GB queda dicho, en vez de implícito.
- La decisión pendiente de ADR-154 §5 queda tomada y registrada.

**En contra**

- Los techos son más altos que la estimación original: 3,0 GB contra
  ~1,6 GB en el peor perfil. Es lo que el producto consume hoy.
- El margen de P2 en caliente es chico, cerca del 9 % sobre lo medido antes
  de ADR-190, y menor que el ruido de M2. La medición de §4 puede dar
  «no cumple».
- El gate es manual hasta que se automatice.
- Un equipo de 4 GB queda fuera del soporte declarado.

## Alternativas descartadas

- **Aceptar el exceso sin cambiar el número.** Dejaba escrito un
  presupuesto que se sabe incumplido y ningún límite real.
- **Optimizar antes del merge.** Lo que queda por optimizar es caro y
  frenaba el PR por semanas, sin garantía de llegar a 1,6 GB.
- **Un gate de regresión por porcentaje.** El ruido medido de M2 lo vuelve
  inservible (§3).
