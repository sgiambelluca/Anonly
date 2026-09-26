<!-- CONTEXT: scope=adr | dependencias=architecture/07_Performance_Strategy.md,roadmap/Ciclos_Y_Documentos_Reales_Plan.md,roadmap/Ciclos_Y_Documentos_Reales_Medicion.md,roadmap/Optimizacion_De_Memoria_Plan.md,roadmap/Gates_Leak_Stress_Plan.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-153-El-Gate-De-Tiempos-Se-Mide-Sobre-El-Producto.md,adr/ADR-159-La-Retencion-Se-Lee-Del-Heap-No-Del-RSS.md | audiencia=humanos+IA | fase=11 -->

# ADR-185 — Gates de fuga y estrés sobre Electron empaquetado

- **Estado**: Aceptado para implementación; validación CI pendiente.
- **Fecha**: 2026-09-25.
- **Decidido por**: planificador de Hito 11.
- **Alcance**: infraestructura de tests y CI; sin cambio de producto, contrato,
  dependencia, presupuesto de ADR-146 ni perfiles.

## Contexto

`tests/leak/` y `tests/stress/` no existen y sus scripts apuntan a Vitest/Node.
El criterio de fuga de T-9 depende del conteo de workers y del heap JS con GC
forzado por CDP dentro de la app `app://`; no puede probarse con un test de
funciones de Node. `performance.measureUserAgentSpecificMemory()` no está
disponible en el shell empaquetado y el RSS varió unos 250 MB entre ciclos sin
fuga (`Ciclos_Y_Documentos_Reales_Medicion.md` §1). Un gate que falle por el
RSS daría falsos positivos. T-9 ya definió diez ciclos, dos regímenes y el
umbral de crecimiento del heap antes de medir.

El perfil de 200 páginas escaneadas de T-3 completó seis importaciones con
picos M2 de 1,42–2,01 GB y tiempos de 108–119 s, frente a 50 páginas de
1,33–1,81 GB y 28–31 s. T-3 lo declaró **caracterización, sin threshold**.
La cota M1 de 512 MB de ADR-146 no es el pico total M2 y no sirve como
aserción de estrés. Se necesita un centinela de escala, declarado como tal,
antes de convertir el perfil en un gate; no se cambia el objetivo contractual.

## Decisión

1. `pnpm test:leak` construye el cliente con `VITE_E2E=1` y el shell, y corre
   una suite Playwright serial sobre Electron empaquetado. Reutiliza
   `tests/perf/support/leakCycles.ts` sin duplicar colector. Usa los tres
   perfiles de T-9: L1, diez P1 encadenados; L2, diez P2 encadenados; L3,
   diez P1 con reposo de 90 s. El fixture escaneado se genera fuera del
   Electron medido y nunca se guarda en Git. Cada ciclo debe llegar a
   `PIPELINE_READY`, cerrar por la UI real y producir lectura del heap del hilo
   principal y del inventario de workers. Timeout, heap principal ilegible,
   ciclo faltante o fase ausente fallan. Los pthreads ONNX pueden tener heap
   ilegible por CDP aun en una corrida válida de T-9; se informa su conteo,
   sin convertirlo en fallo ni en cero bytes.
2. El veredicto bloqueante de fuga usa **solo** `workersGrow` y `heapGrows`
   de `judgeLeak`: el ciclo 10 no puede superar el máximo de workers de los
   ciclos 2–4; la pendiente del heap principal debe superar dos errores
   estándar **y** 5 MB acumulados entre los ciclos 2–10 para fallar. El
   primer uso se excluye de la pendiente. En L3 los workers deben haber
   llegado a cero tras cada reposo. En L1 `NER_MODEL_READY` no debe reaparecer
   después del primer ciclo: si lo hace, el régimen encadenado no quedó
   ejercitado. RSS, presión, tiempos y WASM se informan pero **no deciden**
   este gate; el resultado no descarta fugas internas de WASM en un worker
   persistente.
3. `pnpm test:stress` construye los mismos artefactos y corre una suite
   Playwright serial con P2 de 50 y 200 páginas escaneadas, sintéticos y
   deterministas. Reutiliza `generateText50p/200p`,
   `getOrGenerateScannedFixture` y `measureProfile`; genera el PDF fuera del
   Electron medido. Cada perfil tiene su propia instancia y un ciclo
   frío→cerrar→caliente. Deben terminar las cuatro importaciones, con grupos
   en **cada página centinela** de `TEXT_50P_ENTITY_PAGE_INDICES` o
   `TEXT_200P_ENTITY_PAGE_INDICES` (5 en 50p y 20 en 200p, incluidas las
   páginas 40 y 190), ventana M2 legible y tiempo legible. El colector
   registra los índices de miembros de `ENTITY_GROUP_CREATED`; un conteo
   total de grupos no prueba que llegaron a las páginas finales. El timeout
   de 200p es 900 s por
   importación y 35 min por caso, fijado en T-3; no se alarga tras un fallo.
4. El centinela de escala compara dentro de la misma ejecución y host, para
   cada temperatura: `M2(200p) / M2(50p) <= 3` y
   `import→Ready(200p) / import→Ready(50p) <= 8`. T-3 observó razones
   inferiores a 1,6 y 4,3 respectivamente; los márgenes cubren variación
   del runner sin esconder una multiplicación grave del costo por cuadruplicar
   páginas. Una base cero, muestra ausente o condición de calidad fallida
   falla el gate. Son **guardas relativas de regresión**, no los objetivos de
   512 MB/8 s/60 s de §1 ni un presupuesto aprobado para 200 páginas.
5. Ambos jobs de CI corren en macOS con assets first-party mirroreados y
   cacheados, Chromium de Playwright instalado y timeout explícito; detectan
   `.spec.ts` en sus directorios. No se usan documentos reales ni se suben
   PDFs o trazas como artefactos. Los scripts y la tabla canónica §11.4 se
   actualizan juntos. Windows nativo sigue como validación separada; un verde
   Mac no afirma igualdad de consumo ni tiempo en Windows.
6. **Desviación acotada de R-11/P-8:** `playwright.leak.config.ts` y
   `playwright.stress.config.ts` exportan por defecto el objeto de configuración
   que carga Playwright, siguiendo los cuatro `playwright*.config.ts`
   preexistentes. La excepción aplica solo a estos dos archivos de
   configuración de una herramienta externa; tests, helpers y código de
   producto mantienen exports nombrados. Se registra aquí conforme a
   `Code_Standards.md` (desviaciones por ADR).

## Consecuencias

El gate de fuga prueba señales que T-9 mostró estables sin prometer una
medición total de memoria. El gate de estrés detecta fallo/OOM, pérdida de
trabajo y crecimiento desproporcionado en un documento largo sin convertir el
RSS de una Mac en un límite universal. Ambos cuestan minutos de CI y se
ejecutan en jobs separados del test unitario. `roadmap/Gates_Leak_Stress_Plan.md`
fija las aserciones, artefactos y puertas de implementación.
