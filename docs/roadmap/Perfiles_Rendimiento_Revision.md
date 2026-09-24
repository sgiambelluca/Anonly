<!-- CONTEXT: scope=roadmap-plan | dependencias=roadmap/Rendimiento_Experimentos_Plan.md,roadmap/Hilos_NER_Medicion.md,roadmap/Reconocedores_OCR_Medicion.md,roadmap/Optimizacion_De_Rendimiento.md,ui/React_Client.md,core/Contracts.md | audiencia=humanos+IA | fase=11 (revisión provisional de perfiles tras las curvas macOS 1 y 2; Windows nativo pendiente) -->

# Perfiles de rendimiento — revisión tras las curvas macOS

## Estado de la decisión

Las dos primeras curvas permiten **descartar como mejora local** fijar 6 u 8
hilos ONNX para NER en la Mac medida, y muestran que 3/4 reconocedores OCR
aceleran R2 real sin cambiar detecciones. **No alcanzan para publicar perfiles
nuevos**: falta repetir ambas curvas en Windows nativo ventilado y medir memoria
WASM/native por reconocedor para cuantificar el costo incremental. Esta revisión
propone la forma de la decisión y explicita los huecos; no cambia settings,
contratos, presupuesto ni código de producto.

## Qué configura hoy cada preferencia

`performancePreset` persiste `auto | low | high`. La UI deriva los overrides antes
de crear el Core; un cambio que altera el override sin documento abierto recrea
el Core. `auto` no envía `workerPool` y `buildDefaultEngineConfig` decide con
`navigator.hardwareConcurrency` y `navigator.deviceMemory` cuando está
disponible. La selección `lowResource` usa menos de 4 núcleos o menos de 4 GiB.
El Core no consulta presión ni memoria libre del SO.

| preferencia actual | PDF | OCR | plazas NER | Render | hilos ONNX internos |
|---|---:|---:|---:|---:|---|
| Bajo (`low`) | 1 | 1 | 1 | 1 | selección automática del runtime |
| Alto (`high`) | 4 | 2 | 2 | 4 | selección automática del runtime |
| Automático (`auto`), equipo no `lowResource` | escala con CPU, tope del Core | 2 | 2 | escala con CPU, tope del Core | selección automática del runtime |
| Automático (`auto`), `lowResource` | 2 | 1 | 1 | 2 | selección automática del runtime |

Las **plazas NER no son workers NER ocupados**: el motor recorre páginas de forma
secuencial y el banco observó un solo job a la vez. En la Mac M1 el runtime
eligió 4 hilos internos tanto para el control como para el brazo explícito 4.
Por eso llamar «Alto» a `nerPoolSize = 2` no implica dos inferencias paralelas ni
permite atribuirle el resultado del brazo ONNX 8.

## Matriz candidata para revisar con Windows

| nivel futuro | ONNX NER | reconocedores OCR | otros pools | evidencia y decisión pendiente |
|---|---|---|---|---|
| Bajo | sin valor nuevo decidido | 1 actual | 1 actual | No se midió 1–2 hilos internos ni OCR1 en esta campaña; comprobar calidad, tiempo y memoria antes de redefinirlo. |
| Intermedio | automático del runtime | 2 | PDF/Render actuales por capacidad | Ancla existente; en la Mac, NER automático efectivo 4 y OCR2 control. |
| Alto | automático del runtime en la Mac; 6/8 no aportaron | 3 o 4, candidato | sin cambio decidido | En R2 Mac, 3 bajó `Ready` 13,7 % y 4 21,0 %; falta costo WASM/native y curva Windows. |
| Automático | resolver a uno de los tres niveles anteriores | valor del nivel resuelto | valor del nivel resuelto | Umbrales y señales por plataforma aún sin validar; no usar cantidad de páginas como señal de carga. |

La matriz es **una propuesta de experimentación**, no valores aprobados. La
Mac sin ventilador puede perder frecuencia; los pares intercalados contienen
la deriva, pero no establecen qué hacer en Windows ni en equipos de 4/16/32
GiB. Los picos de RSS total del OCR tampoco se convierten en «MB por worker».
Un nivel Alto podría justificar más memoria por una reducción material de
tiempo, siempre que el costo medido, los presupuestos vigentes y la calidad lo
permitan. El presupuesto de imágenes vivas sigue en 128 MiB hasta una campaña
separada.

## Regla de resolución y señales necesarias

La preferencia persistida y el nivel resuelto deben ser campos distintos. Si el
usuario elige Automático, la interfaz puede mostrar «Modo automático —
consumo/rendimiento medio» **solo si** la política resolvió Intermedio y el
Core recibió su configuración efectiva. El texto no debe derivarse de un valor
solicitado que fue reducido o ignorado por el runtime. El nivel, la configuración
efectiva y las razones de resolución deben poder auditarse en tests.

Señales actuales: número lógico de CPU y RAM aproximada cuando
`navigator.deviceMemory` existe. No hay señal contractual de RAM libre, presión,
temperatura ni alimentación para el Core. Una futura resolución automática que
dependa de memoria disponible requiere un canal seguro desde el shell, sin
lecturas del SO en `packages/`, con permiso, ausencia de dato, refresco y
reserva para el SO definidos. Un valor de capacidad instalada no sustituye la
presión actual; tampoco justifica un umbral sin pares de tiempo/memoria por
plataforma. Hasta tener esa evidencia, el comportamiento conservador es el
actual `auto`, sin prometer que eligió un nivel óptimo.

Resolución propuesta al iniciar el Core, **antes** de abrir un documento. Si
cambia una señal mientras hay documento y ediciones abiertas, conservar la
configuración efectiva hasta cerrar y crear la siguiente sesión; mostrar el
nivel realmente vigente, no uno futuro. Evitar redimensionar pools en caliente
sin ADR y tests propios. Una elección manual prevalece hasta que el usuario
vuelva a Automático.

## Migración y puerta de implementación

Un `high` ya persistido significa hoy OCR2, no un futuro OCR4. Para no aumentar
su consumo en silencio, la migración propuesta es **versionada**: `low` legado
se conserva como Bajo; `high` legado se resuelve a la configuración heredada
OCR2 (candidata a Intermedio); `auto` legado conserva selección automática
heredada hasta que la política nueva esté validada. El nuevo Alto requiere
elección explícita o una resolución automática sustentada por la curva. El ADR
de UI/settings debe definir nombre de clave/versión, lectura de datos viejos,
persistencia idempotente y texto de la migración antes de codificarla.

La puerta para ese ADR y el código de producto es:

1. Repetir NER A/4/6/8 y OCR 2/3/4 sobre R1/R2 en **Windows nativo ventilado**,
   con controles intercalados, densidad de caracteres, calidad y cancelación.
2. Obtener memoria WASM/native por reconocedor o declarar un límite de memoria
   verificable por otra vía; decidir si 3 o 4 cumple el compromiso de memoria
   y los presupuestos. Si se quiere variar `LiveImageBudget`, hacer otra
   campaña con una variable por vez.
3. Medir las variantes de Bajo y, al menos, los rangos de capacidad entre la
   Mac de 8 GiB y Windows. Definir reserva de SO y reglas cuando falta RAM.
4. Presentar al humano la matriz final, la política automática y la migración.
   Después de su decisión, redactar ADR y actualizar `Contracts.md`, specs de
   motores/UI y tests antes de tocar implementación. ADR-168 a ADR-178 están
   ocupados por otra tarea y no se usarán.
