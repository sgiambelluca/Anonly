<!-- CONTEXT: scope=adr | dependencias=roadmap/Optimizacion_De_Memoria_Plan.md,roadmap/Atribucion_Recursos_Renderer_Medicion.md,core/NER_Engine.md,adr/ADR-018-First-Party-Assets.md,adr/ADR-023-NER-Config-Canonical-Model-Multilingue.md,adr/ADR-147-Perder-Un-Identificador-Cubierto-Es-Una-Regresion.md,adr/ADR-154-La-Memoria-No-Se-Compra-Bajando-El-Paralelismo.md,adr/ADR-167-El-Modelo-De-NER-Se-Libera-A-Los-15-s-De-Inactividad.md | audiencia=humanos+IA | fase=11 -->

# ADR-179 — El empaquetado de NER se evalúa sin cambiar el modelo

- **Estado**: Accepted para el experimento; evaluación completada el 2026-09-23, con A conservado según `roadmap/Empaquetado_NER_Medicion.md`.
- **Fecha**: 2026-09-23.
- **Decidido por**: El planificador, ejecutando el punto 1 de `roadmap/Optimizacion_De_Memoria_Plan.md` §2ter tras el cierre y la revisión del punto 2.
- **Numeración**: ADR-168 a ADR-178 pertenecen al trabajo simultáneo de UI. Los ADR de esta campaña comienzan en 179; este ADR no reemplaza ni modifica los de UI.
- **Relacionado con**: ADR-018 (assets first-party), ADR-023 (modelo fijado), ADR-147 (regresión por entidad), ADR-154 (memoria y paralelismo), ADR-167 (ciclo de vida de NER).
- **Parte de**: Hito 11 — recursos, punto 1 de la secuencia 2 → 1 → 3.

## Contexto

El punto 2 terminó sin identificar una fuga ni un ahorro equivalente al residuo histórico del renderer. T-11/T-12 sí midieron un costo atribuible al modelo NER: 487 MB de WASM y unos 94 MB de heap JS para un ONNX Q8 de 178.495.423 bytes. Esos números no demuestran que cambiar la disposición de los bytes reduzca la memoria de la sesión; la copia transitoria durante la carga sigue siendo una hipótesis. El punto 1 es **evaluar** esa hipótesis, no cambiar el modelo o prometer un ahorro.

El producto carga `Xenova/bert-base-multilingual-cased-ner-hrl` con `@huggingface/transformers@4.2.0` y su ONNX Runtime Web empaquetado. El asset original está fijado en `assets.lock.json` a la revisión `263e82c06569c8c2ac46238a7ae5107598934234`, SHA-256 `5b65139844be260b624a2a13782b01d122e613d64ce16ed0ba4d82e0b816f1a9`. El kernel invoca `pipeline("token-classification", modelId, { dtype: "q8", ... })`; el cargador de esta versión pide un archivo `.onnx` y admite `use_external_data_format` con un archivo adyacente `<nombre>.onnx_data`. ONNX Runtime Web admite datos externos si recibe la lista de archivos. La ruta específica de Transformers.js construye esa lista y la entrega a la sesión. **La compatibilidad está comprobada en el código instalado y en Node; la del Chromium/WASM empaquetado todavía debe pasar el gate de §4.**

El formato `.ort` es soportado por ONNX Runtime Web directamente, pero el cargador de `pipeline()` usado aquí pide `.onnx`. Probar `.ort` exigiría sustituir o rodear ese cargador, alterar la integración de inferencia y probablemente la selección de assets. No es una alternativa comparable de un solo cambio para este experimento. Se descarta de este brazo; volver a considerarlo requiere otro ADR con esa arquitectura explícita.

## Decisión

### 1. Un brazo experimental de datos externos, sin cambio de pesos

Se comparan dos artefactos del **mismo** ONNX Q8:

| Brazo | Asset servido | Opción de carga |
| --- | --- | --- |
| A, control | `model_quantized.onnx` original fijado por `assets.lock.json` | llamada actual a `pipeline()` |
| B, candidato | `model_quantized.onnx` convertido + `model_quantized.onnx_data` adyacente | la misma llamada con `use_external_data_format: 1` |

No se cambian pesos, cuantización, tokenizer, labels, batch, umbral, hilos, pools, DPI ni criterio de detección. El brazo B se construye y sirve **solo desde el banco opt-in de `tests/perf/`**, con un parche reversible de la opción de carga en el build experimental. No se altera el default del producto, el `NerConfig` público ni `Contracts.md`. El arnés debe construir A y B desde la misma revisión y comprobar que el único diff de fuente de producto entre ambos es esa opción. Los binarios y assets de cada brazo se identifican por digest antes de medir.

Esta es una **campaña de recursos declarada por adelantado** en el sentido de ADR-124 §1. El trabajo experimental vive en `tests/perf/` y su soporte; no autoriza a mezclar cambios funcionales de dos motores ni a editar el spec desde la mano implementadora. Si el resultado justificara adoptar B, el planificador deberá cerrar primero la estrategia de assets derivados para `assets.lock.json`/`pnpm assets:mirror` mediante una enmienda de este ADR y del spec. Hasta entonces los archivos grandes viven en `.measure/`, fuera de Git y fuera del build normal.

### 2. Conversión fijada y reproducible

El implementador versiona el conversor bajo `tests/perf/support/` y lo ejecuta con Python 3.12 y `onnx==1.22.0` en un entorno aislado. Es una **herramienta offline del banco**, autorizada por R-12/R-18 aquí; no se agrega una dependencia de runtime, del motor ni del monorepo pnpm. Para reproducir exactamente los hashes siguientes en este banco se fijan también `numpy==2.5.3`, `protobuf==7.36.2`, `ml_dtypes==0.6.0` y `typing_extensions==4.16.0`. La herramienta debe fallar antes de escribir si el SHA-256 del ONNX fuente no coincide con el pin anterior.

La operación es `onnx.load(source)` seguida de `onnx.save_model(model, target, save_as_external_data=True, all_tensors_to_one_file=True, location="model_quantized.onnx_data", size_threshold=0, convert_attribute=False)`. `target` se llama **`model_quantized.onnx`** y el sidecar queda en su mismo directorio. No se ejecuta optimización, cuantización, reexport ni conversión a ORT. Después se valida con `onnx.checker.check_model(target)`, se recargan fuente y salida y se comprueba igualdad de los bytes de los 352 inicializadores, su orden/nombre y los 1516 nodos del grafo. El conversor no puede aceptar rutas de sidecar absolutas ni fuera del directorio de salida.

Prueba local del 2026-09-23, repetida dos veces con salida idéntica:

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| fuente `model_quantized.onnx` | 178.495.423 | `5b65139844be260b624a2a13782b01d122e613d64ce16ed0ba4d82e0b816f1a9` |
| candidato `model_quantized.onnx` | 871.928 | `212d5c76983e8e0a97a60d4e6733975980ccdc0792f335a590c503f92ee24d49` |
| candidato `model_quantized.onnx_data` | 177.637.924 | `abe8b9215a0dcbf20cd1e48758d927ce974f6dc373b3171360848ee5890e8e52` |

Estos hashes identifican los **artefactos de prueba**, no actualizan el lock de producción. El banco comprueba los tres antes de cada tanda y registra sus tamaños. Si otra plataforma produce bytes distintos, se registra como incompatibilidad de reproducción; no se acepta silenciosamente ni se reemplaza el hash esperado durante la corrida.

### 3. Comprobación preliminar y su límite

Con el paquete `@huggingface/transformers@4.2.0` instalado, el brazo B cargó en Node desde la carpeta local usando `dtype: "q8", use_external_data_format: 1`, sin acceso remoto. Cuatro textos sintéticos dieron **la misma salida cruda de tokens y scores** que A: SHA-256 de la serialización `36050fab4342025d9adec4ac5e6c60d6833f6906b41219392a4b91525fa368fb`; los conteos fueron 8, 7, 20 y 11. Eso comprueba el archivo, el nombre del sidecar y la API del cargador. Node usa otro backend; no acredita igualdad de salida ni memoria en el producto Chromium/WASM (ADR-147 §6).

## Gates del experimento

### 4. Compatibilidad y calidad, antes de atribuir memoria

1. Arrancar **ambos brazos en el shell Electron empaquetado**, con los assets servidos por el origen `app://` propio, Web Workers reales y el WASM fijado por el build. B debe cargar el modelo, inferir, emitir `NER_MODEL_READY` y llegar a `Ready` sin requests a terceros. Un error de carga, sidecar ausente, ruta errónea, fallback de modelo o salida vacía aborta el brazo B antes de medir.
2. Comparar A y B sobre el mismo corpus sintético medido en Chromium/WASM. La huella exacta de las ocurrencias NER incluye página, tipo, valor normalizado, valor emitido, confidence y geometría; ninguna ocurrencia puede desaparecer, aparecer, cambiar de score o moverse. Se compara por documento y por entidad, no por porcentajes agregados. La baseline de ADR-147 mantiene su identidad del asset original; **no se reescribe ni se auto-promueve** por el candidato. El comparador experimental aplica sus reglas de cero pérdidas y cero falsos positivos nuevos a los resultados de ambos brazos, además de exigir la igualdad exacta anterior. **Cada brazo registra su identidad de assets real**: B lleva los hashes del grafo y sidecar, y no finge tener el SHA-256 del ONNX original para satisfacer el comparador de identidad de ADR-147.
3. Ejecutar el corpus completo de calidad disponible y los controles de ADR-147. Si el arnés usa documentos reales R1/R2, registra solo digests y métricas permitidos por T-10/T-12: no persiste texto, nombres, tokens ni PDFs en `.measure/`. La huella de esos documentos se coteja por digest como en T-12; eso no sustituye la comparación por entidad del corpus sintético.
4. Una conversión que pasa `onnx.checker` o una inferencia en Node **no** exime los tres pasos anteriores. Tampoco se admite subir o bajar un umbral de calidad para hacer pasar B.

La referencia de ADR-147 faltaba al iniciar este experimento. El planificador
promovió manualmente `tests/quality/baselines/reference-v1.json` el
2026-09-23, desde dos corridas independientes del brazo A en Electron
`app://`/Chromium/WASM cuyos candidatos fueron idénticos byte por byte
(SHA-256 `8d449a206579ef250c88006dcccc3763810c02e77d0f1502c16d7d82518b4fdb`).
Ambas completaron 26/26 documentos, con 78 entidades esperadas, 74 cubiertas y
18 falsos positivos; el comparador oficial aceptó la segunda contra la
referencia. Es una baseline de **no regresión**, no una declaración de que se
alcanzaron los objetivos absolutos de calidad de `MVP.md` §5. La referencia
conserva el hash del asset original y no se modifica para hacer pasar B.

### 5. Medición y decisión

Con compatibilidad y calidad verdes, correr A/B intercalado en una misma sesión del banco macOS y con órdenes alternados, como T-8/T-12. Mínimo tres pares completos por perfil elegido; cada par procesa el mismo fixture y registra el orden. Reutilizar el instrumento existente y sus controles de presión, target ocupado/no observable y overhead. Si una sonda no observa la carga NER, registrarlo: un hueco no cuenta como ahorro. No comparar RSS, WASM y heap JS mediante resta contable.

Publicar **por corrida y pareado**, además del resumen: duración de carga del modelo y `import→Ready`, pico RSS de árbol M2, M1, pico posterior a `Ready`, memoria WASM/heap JS cuando sean observables y nivel sostenido con el modelo cargado y después de liberarlo por `nerIdleDisposeMs`. Separar el efecto durante la carga del nivel sostenido; una baja posterior por el temporizador de 15 s no es atribuible al empaquetado. El perfil P2 y al menos un documento de texto real R1, si está disponible bajo el protocolo confidencial de T-10, evitan que un fixture liviano decida solo. Registrar el costo del instrumento y la deriva de controles idénticos.

**Conservar B solo si** compatibilidad y calidad son idénticas, la mejora de memoria es consistente entre pares y mayor que la dispersión de controles, y el costo de carga/`Ready` no supera esa dispersión de forma material. Informar por separado cualquier mejora transitoria y sostenida. Si la señal es mixta, menor que el ruido, no observable o hay peor calidad, **revertir el brazo** y conservar A. No se acepta como objetivo el ahorro especulativo de 100–180 MB del plan anterior. El informe de medición documentará la decisión y la eventual enmienda de adopción; este ADR autoriza construir y medir, no cambiar el default.

## Consecuencias y límites

- La implementación del experimento puede comenzar con contratos públicos y spec cerrados, sin nuevo evento, tipo ni error code.
- La salida de conversión ocupa casi lo mismo en disco que el original. Separar pesos del grafo **no prueba** menor memoria WASM, menor RSS ni menor tiempo; esas tres afirmaciones se miden.
- El soporte de datos externos de la versión instalada y la prueba Node reducen el riesgo de integración, pero el primer gate obligatorio sigue siendo Chromium/WASM empaquetado.
- Los derivados no se incorporan a `assets.lock.json` ni al instalador durante la evaluación. La forma de distribuir y verificar un derivado si B gana es una decisión posterior, explícita y previa a tocar el default.

## Fuentes técnicas

- Código y tipos instalados de `@huggingface/transformers@4.2.0`: `dist/transformers.js`, `getModelDataFiles`/`getSession`; `types/utils/hub.d.ts`, opción `use_external_data_format`.
- [ONNX — External Data](https://github.com/onnx/onnx/blob/main/docs/ExternalData.md): API `save_model` y ubicación relativa del sidecar.
- [ONNX Runtime Web — Working with Large Models](https://onnxruntime.ai/docs/tutorials/web/large-models.html): paso explícito de datos externos en navegador.
- [ONNX Runtime — ORT model format](https://onnxruntime.ai/docs/performance/model-optimizations/ort-format-models.html): soporte de `.ort` en la API directa, distinto de la ruta actual de Transformers.js.
