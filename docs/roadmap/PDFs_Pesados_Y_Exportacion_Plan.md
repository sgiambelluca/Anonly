<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,adr/ADR-174-Los-PDFs-Pesados-Se-Miden-Hasta-El-Archivo-Exportado.md,adr/ADR-146-Son-Dos-Presupuestos-De-Memoria-No-Dos-Limites.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,core/Contracts.md,core/Render_Engine.md,core/Export_Engine.md,roadmap/PDFs_Pesados_Y_Exportacion_Medicion.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# Punto 3 — Banco de PDFs pesados, render y exportación

**Estado (2026-09-23): punto 3 cerrado como caracterización; banco implementado, medido y versionado en `8f0d7f0`.**
Este plan implementa el punto 3 de `Optimizacion_De_Memoria_Plan.md` §2ter y la decisión de ADR-174. La entrega es un banco opt-in y un informe de corridas, no una optimización del producto.

La ejecución de nueve corridas intercaladas, cancelación y gates está en `PDFs_Pesados_Y_Exportacion_Medicion.md`. Los rangos observados no alcanzan para atribuir el exceso a una copia concreta ni a color/códec por separado. Este plan conserva el protocolo para reproducir o ampliar la medición.

## 1. Perfiles y generación

Versionar un generador determinista en `tests/perf/support/`. Usar dependencias ya instaladas, sin descarga ni librería nueva. Generar fuera del Electron medido en un proceso Chromium plano, cerrarlo y recién entonces iniciar la app. Cachear bajo `.measure/fixtures/` con clave que incluya versión del generador, parámetros y semilla; verificar al leer caché. Se permite variar el tamaño de imagen que el generador documente, pero **no** cambiarlo silenciosamente entre repeticiones de la misma campaña.

| Perfil | Contenido sintético mínimo | Qué separa |
| --- | --- | --- |
| C0, control | P1 de 10 páginas de texto nativo existente | deriva entre corridas |
| H1, color | al menos 6 páginas A4, imagen RGB de al menos 1800 × 2400 px por página, codificada JPEG, PDF fuente ≥ 8 MiB | bytes comprimidos grandes y decodificación color |
| H2, grises | mismas páginas, geometría y patrón base que H1, píxeles visualmente grises (R=G=B) en PNG sin pérdida, PDF fuente ≥ 8 MiB; Chromium los codificó como RGB PNG | representación de imagen sin cambiar cantidad/geometría de páginas |

H1/H2 usan semilla fija, patrón con entropía suficiente para alcanzar el piso de bytes y una franja de control de alto contraste por página con número de página y texto vecino ficticio. Registrar por corrida versión/semilla, número y dimensiones de páginas, modo/color, codec, tamaño y SHA-256 del PDF. Fallar si tamaño o geometría incumplen; un fixture vacío o casi uniforme no representa esta clase. El generador debe tener un test pequeño de determinismo/estructura que no inicie Electron ni procese el PDF pesado entero. Mantener **la misma salida binaria** durante toda la tanda; una variación de hash invalida la comparación. El corpus es sintético: se puede conservar el PDF y el export en `.measure/` para inspección local, nunca en Git.

## 2. Camino del producto y fases

Usar `tests/e2e/support/electronApp.ts` y el build `app://` con `VITE_E2E=1`. Fijar y registrar configuración de OCR, NER, preset, DPI, formato/calidad de export y SHA del build en cada tanda. C0/H1/H2 deben usar la **misma configuración**; el procesamiento OCR/NER real sigue habilitado salvo decisión documentada antes de la primera corrida. No variar pool, paralelismo, modelo ni DPI entre perfiles para hacer pasar un caso.

Por corrida: arrancar Electron aislado → tomar base fría → importar y esperar `PIPELINE_READY` → dejar pasar el seed/post-Ready → pedir por `RENDER_REQUESTED` el render `full` de **todos los índices** en `kind: "anonymized"`, esperar `RENDER_FINISHED` y comprobar que devuelve exactamente esos índices → solicitar export con opciones fijas → observar `EXPORT_STARTED`, cada `EXPORT_PROGRESS` y `EXPORT_FINISHED` → descargar el blob por la UI → cerrar documento y tomar reposo. No contar un preview automático como render completo. Cada fase tiene timeout explícito y reporta fallo tipado, nunca ausencia silenciosa. Si la UI exige confirmar “sin grupos”, hacerlo explícitamente y registrarlo.

La exportación hace su propio render full por página: **el render explícito y el export son ventanas distintas**, aunque la caché del primero pueda influir en la segunda; registrar el orden y no presentar la exportación como una corrida fría independiente. Para M1, seguir el ciclo frío→cerrar→caliente de ADR-146 con el mismo fixture; para el costo total de la operación informar además picos absolutos de render, export y post-export, no restarlos de M2 de importación. Un muestreo sin muestras en una ventana produce `null` y motivo.

## 3. Datos y observabilidad

Reutilizar `memorySampler`, sondas CDP/heap/WASM/nativa y presión del sistema **cuando estén disponibles**. Guardar serie cruda con reloj comparable a los eventos, muestra por proceso y duración/cadencia efectiva de la sonda. Del bus recoger tiempos de fases, `RENDER_*`, `EXPORT_*` y jobs `render-page`/`export-page`; correlacionar por `jobId` sin retener resultados binarios. Registrar por página progreso y, si el payload público lo ofrece, `byteLength` del encoded image. Registrar tamaño y SHA-256 de la descarga. Guardar salida JSON bajo `.measure/` con versión de esquema y marca `observable | estimado | no observable` para cada atribución.

Separar en el informe: bytes fuente y salida **exactos**; bytes de imagen codificada **exactos solo si observados**; `width × height × 4` por ráster RGBA como **cota teórica por instancia**, sin inferir cuántas instancias viven; RSS/heap/WASM/nativo observados con sus unidades y límites. “Copias simultáneas del PDF” y “buffer interno de ensamblado” se informan como no observables si las sondas públicas no los distinguen. Nunca calcularlos restando componentes del RSS ni declarar que el incremento de RSS es una copia concreta.

Repetir **tres veces por perfil**, un Electron nuevo por repetición, intercalando C0 entre H1/H2. Publicar todas las corridas, orden, mediana/rango y dispersión de C0; no ocultar fallos ni reintentos. Si memoria de sistema, build, configuración o hash de fixture cambian, dividir la tanda e impedir la comparación directa. No probar un ahorro numérico ni modificar el presupuesto de ADR-146.

## 4. Validación del PDF y cancelación

Abrir la **descarga real** con pdf.js o pdf-lib del banco. Verificar parseo, número de páginas, dimensiones por página dentro de una tolerancia documentada (p. ej. ≤ 1 pt) y render de cada página sin error. Comparar regiones conocidas de la franja sintética contra control del original: número de página y texto vecino deben seguir legibles, y la página no puede estar vacía. Registrar método, escala y resultado por página; un control original ilegible invalida la prueba. Esto es fidelidad de export, no el gate OCR de redacción de ADR-148. El test de validación debe incluir un negativo artificial (PDF en blanco o página faltante) para demostrar que detecta daño sin tocar producto.

En H1, una corrida adicional inicia export, espera `EXPORT_PROGRESS.current >= 1` y emite `CANCEL_REQUESTED` por `EventChannel.Pipeline` desde `__anonlyCore`. Debe observar `PIPELINE_CANCELLED` para ese documento, ausencia de `EXPORT_FINISHED` y ausencia de enlace/descarga parcial. Si el export acabó antes de inyectar cancelación, informar `not exercised` y aumentar páginas en un fixture de cancelación versionado, sin cambiar H1 medido. Registrar latencia de cancelación y memoria de reposo, sin atribuirle el SLA de <200 ms hasta medirlo. No añadir un botón de cancelación a la UI dentro de este banco.

## 5. Entregables y cierre

- Generador/caché determinista, arnés opt-in y tests del generador/verificador.
- Comando de ejecución documentado **cuando exista**, con prerequisitos de build, espacio, tiempo y ubicación de reportes. No sumarlo a `pnpm test:perf` cotidiano ni a §11.4 sin ADR posterior.
- JSON crudo por corrida y `PDFs_Pesados_Y_Exportacion_Medicion.md` con tabla de tiempos/picos por fase, identidad de fixtures/build, resultado de export/cancelación, dispersión y huecos de observación. No promover un resultado si faltó descarga o validación de calidad.
- Validar lint, typecheck, tests unitarios/contract y el banco scoped. Si un perfil agota memoria o excede el timeout, registrar el fallo real como límite observado y continuar con las demás corridas; no reducir el fixture para producir un verde sin versionar el cambio.

**Regla de parada:** ambigüedad de evento/contrato, imposibilidad de ejecutar export real, o necesidad de editar motores/contratos/specs → detener esa parte y reportar archivo, sección y pregunta concreta al planificador. Una sonda no disponible se reporta como límite de observación y no bloquea las otras mediciones.
