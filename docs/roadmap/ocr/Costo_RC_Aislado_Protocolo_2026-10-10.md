<!-- CONTEXT: scope=experimento-costo-rc | dependencias=adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,roadmap/mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,core/OCR_Engine.md,tests/perf/README.md | audiencia=planificador+implementador+revisor | fase=12 -->

# RC — medir el costo aislado y confirmar la implementación

**Estado actual (2026-10-10): RC aceptado e implementado; costo adoptado
confirmado, caracterización M-O1 completa 700/700 y revisión integral pendiente; SV/CP diferido hasta disponer de más escaneos.** El mantenedor aceptó «incorporar
RC y decidir SV + CP después». ADR-190 y `OCR_Engine.md` v1.18.0 gobiernan
el producto. Las secciones experimentales siguientes documentan el ensayo
ya terminado; la confirmación usa el modo adoptado descrito abajo.

**Origen del experimento.** El mantenedor
preguntó el 2026-10-10 si el costo extra era excesivo y con qué frecuencia
un documento real caería en el fallback de ruido. Su respuesta no acepta
RC, SV ni un umbral. M-O3 fuerza cuatro lecturas en todo el documento: no
puede atribuirse su tiempo o aumento de memoria a unas pocas hojas vacías.
La campaña siguiente separa el costo de RC de ese peor caso.

**Retoma de preparación (2026-10-10).** El smoke experimental terminó
8/8 con resumen completo y sin incoherencias. Los cuatro N1 se recuperaron
en frío y caliente: OSD natural sin veredicto, primera lectura vacía, tinta
entre 0,001198 y 0,001847, cuatro ángulos y escala 1. El planificador verificó
esos crudos además del resumen. La guarda confirmó ausencia de suspensión
al inicio/cierre; ambos dist anteriores quedaron restaurados. Blanco y ruido
A/RC pasaron. Esta prueba acredita fidelidad del candidato, no costo del
documento real ni aceptación de producto. El analizador se reforzó para exigir
esas condiciones de N1 y el análisis offline conservó 8/8 sin incoherencias;
pasaron sus ocho pruebas, lint, formato y tipos focalizados. No se repitió
OCR porque solo cambió el análisis. La campaña de doce quedó habilitada en
`.measure/rc-isolated/campaign-20261010-rc`, con nueva identidad del arnés;
sus resultados terminaron 12/12 válidos, sin fallas ni cambios de entregas.
El [informe del costo aislado](../mediciones/ocr/Costo_RC_Aislado_2026-10-10.md)
registra +0,394/1,022 s hasta Ready en R1 y +19,884/19,112 s en P2N
(frío/caliente), con aumento M2 distinguible solo en P2N. La presión del
sistema no estuvo disponible; las series RSS quedaron preservadas. No se
adoptó producto ni se estimó probabilidad poblacional.
El implementador se retoma en Luna y el revisor queda en Sol por instrucción
del mantenedor, conservando un solo subagente activo.

La decisión de aislamiento del instrumento está en
[ADR-218](../../adr/ADR-218-El-Costo-De-RC-Se-Mide-Sin-Forzar-Todas-Las-Paginas.md),
con la enmienda de confirmación sobre el producto adoptado.

## Confirmación del costo adoptado

**Resultado (2026-10-10, provisional):** smoke 8/8 y costo 12/12 válidos,
en carpetas nuevas `smoke-20261010-adopted-v1` y
`campaign-20261010-adopted-v1` bajo `.measure/rc-isolated/`. La auditoría
confirmó fuente RC idéntica, renderer RC igual al build normal, guardas
positivas al inicio/cierre, ausencia de suspensión y restauración de dist.
R1 agregó 1,185/0,952 s hasta Ready; P2N agregó 19,452/18,713 s
(frío/caliente). M2 de R1 quedó dentro del ruido; P2N frío aumentó 470,8 MB
con rangos separados, mientras el aumento caliente de 351,5 MB tiene
rangos superpuestos. La presión por importación no estuvo disponible en
las 24 ventanas. El [informe](../mediciones/ocr/Costo_RC_Aislado_2026-10-10.md)
separa estas mediciones de las experimentales anteriores.

Después de implementar RC según el spec, repetir ocho corridas de smoke
y doce de costo en carpetas nuevas con `ANONLY_RC_SOURCE_MODE=adopted`.
El modo histórico `experimental` sigue siendo el predeterminado y no se
detecta automáticamente por la fuente. Se registra y valida el modo en
las identidades y en la reanudación; un modo distinto o no admitido aborta.

En el modo adoptado, RC usa la fuente de producto idéntica byte por byte;
A elimina durante el build exclusivamente la cláusula RC del predicado
exacto. El plugin transforma el brazo que difiere de la fuente, conservando
el árbol compartido intacto. Exige una coincidencia exacta y rechaza fuente
alterada, mezclada, ausente o duplicada. Las pruebas puras preservan los
controles históricos y acreditan esta dirección inversa del transformador.
Fuera de las ventanas, el renderer RC debe coincidir con el build normal
recién producido usando la misma configuración, opciones y `VITE_E2E=1`.

La matriz, fixtures exactos, privacidad, instrumento, guardas y restauración
son los mismos. No se reutilizan corridas experimentales ni se resume junto
con ellas; el informe separa el costo A/RC implementado de la caracterización
previa. Se mantiene la presión desconocida si no está disponible.
M-V1 completo se congela después sobre el producto actualizado, en carpeta
nueva. No se ejecutan campañas ni suites pesadas simultáneamente.

## Corrección del instrumento tras revisión (2026-10-11)

Sol rechazó el lote por el archivo de configuración fuera del proyecto de
lint, su export default y catorce conversiones `as unknown as` en observadores
y tests. Luna corrige los tres puntos antes de una nueva revisión de Sol.
No cambia el predicado RC ni se incorpora SV/CP o «Validar muestra».

El build aislado debe exponer su configuración con export nombrado y usar
la API programática de Vite, con `configFile: false` para evitar cargar dos
veces la configuración base. Conserva el directorio de trabajo, opciones,
`VITE_E2E=1`, transformación exacta A/RC, identidad y restauración de dist.
El archivo debe quedar cubierto por el proyecto TypeScript de tests,
sin ignorarlo ni relajar las reglas. No se agregan dependencias.

Los observadores y dobles de prueba usan interfaces mínimas tipadas y
conservan las comprobaciones existentes, sin casts dobles ni supresiones.
La validación incluye los gates globales secuenciales, tests focalizados y
un nuevo smoke sintético adoptado 8/8, con renderer RC idéntico al build
normal recién producido. Las mediciones anteriores conservan su identidad
histórica; esta corrección no repite ni reemplaza la campaña de costo real.

**Resultado de Luna, confirmado por Sol (APPROVED para PR):** config renombrado a
`tests/perf/rc-isolated.vite.config.ts`, CLI con `configFile: false`, sin
excepciones nuevas de lint ni dependencias. Se eliminaron los catorce casts;
`bus.on` declara el retorno real `() => void`, evitando propagar `unknown`
a los listeners del gate. Los cinco gates globales pasaron, con 4408 tests
verdes, un fallo esperado y 77 omitidos, y 347/347 contratos. Pasaron además
31/31 pruebas focalizadas, sintaxis shell y `git diff --check`.

El smoke nuevo `.measure/rc-isolated/smoke-20261011-review-v2` terminó
8/8, cero issues, renderer RC idéntico al normal, identidad adoptada confirmada
al inicio/cierre y guardas válidas sin suspensión. Ambos dist quedaron
restaurados con hashes coincidentes. Sigue provisional por árbol sin commit.
El intento v1 se conserva como preflight abortado por falta del opt-in para
producto sin commit, sin builds ni corridas; no se cuenta como medición.

## Frecuencia observada, no probabilidad poblacional

Recuento sobre las observaciones `production` de M-O2: ausencia natural de
veredicto, primera lectura con cero palabras y tinta real mayor que cero.

| Documento | Páginas | Cumplen la condición RC |
| --- | ---: | ---: |
| R1, escaneo real | 20 | 1 |
| R2, digital rasterizado | 5 | 0 |
| R3, digital rasterizado | 5 | 0 |
| R4, digital rasterizado | 51 | 0 |

La página de R1 es casi vacía, con tinta 0,000489 y sin lectura fiable en
ningún ángulo. Una página completamente blanca, tinta cero, no entra en
RC. En los controles sintéticos de ruido, RC suma trabajo en 16 de 24
hojas. Ninguna de esas proporciones estima la frecuencia en expedientes
reales: los digitales rasterizados tienen píxeles limpios y el único
escaneo real es de buena calidad. Sigue faltando una muestra de escaneos
malos reales para decidir frecuencia y costo de SV.

## Regla candidata exacta

Solo se amplía la rama ya existente de páginas enteras sin veredicto OSD:
además de sus condiciones actuales, entra cuando la primera lectura tiene
cero palabras y `inkRatio > 0`. Prueba 90°, 180° y 270° una vez sobre el
mismo ráster/DPI, usando el comparador vigente de recuperación OSD.

No se fuerza veredicto, tinta, palabras, confianza ni resultados de los
workers. No se cambia `unreadableInk`, el umbral 0,002, las regiones ni la
cadena con veredicto. Tampoco se activa SV ni se cambia CP fuera de esta
rama. Una página que entra en esta rama no hace upscale.

El recuento separa cumplir la condición candidata de agregar trabajo nuevo:
una página sin palabras con tinta de 0,002 o más ya entra en esa rama del
control. La ampliación efectiva corresponde a primera lectura vacía, sin
veredicto, con `0 < inkRatio < 0,002`. Los reconocimientos extra se cuentan
en el transporte observado, no se deducen de la cantidad de candidatas.

## Aislamiento del candidato

Las fuentes de producto de `packages/` y `apps/` permanecen intactas. El
arnés crea dos builds empaquetados, control A y candidato RC. Un plugin
experimental de Vite, alojado fuera de fuentes de producto, transforma
**solo** el predicado de la rama indicada en `ocr.engine.ts` durante el
build RC. Debe encontrar una única coincidencia exacta; cero o varias
coincidencias abortan. A pasa por la misma configuración sin transformar.
El plugin, texto de sustitución y su prueba son parte del arnés, no una
opción de producto. Esta transformación mide un candidato provisional;
no es una implementación adoptada ni autoriza publicarlo.

Se registran hashes del archivo fuente original, del resultado transformado,
del plugin/config y de cada dist, además de las identidades normales de
producto, tests, assets y fixtures. Los dos builds se congelan antes de
medir y se usan sin reconstruir entre corridas. El runner restaura los dist
previos al cerrar y comprueba sus hashes. No se comparte dist ni se ejecuta
durante M-V1 u otra suite. Los datos reales conservan las reglas de privacidad
de las campañas anteriores.

Prueba focalizada del transformador: control idéntico byte por byte;
candidato modifica solo el predicado; fuente distinta o coincidencia repetida
se rechazan. Antes del costo se comprueba el build RC con los cuatro casos
N1 naturales de M-O1 (150/300 dpi, giros 90/270), que deben recuperar el
texto; controles de hoja blanca y ruido. No se ajustan fixtures.

## Matriz y comparación

Doce corridas: dos documentos × A/RC × tres repeticiones. Cada corrida
mide frío y caliente con el instrumento M2 vigente, NER activo y `medium`,
RSS cada 150 ms, sin otra suite simultánea. A/RC se intercalan por documento
y repetición; observador liviano idéntico en ambos y sin imágenes/texto.

- **R1:** escaneo real de 20 páginas, bytes nativos, resultado principal.
- **P2N:** fixture exacto de M-O3, sin cambios: P2 más diez hojas de ruido.
  Diagnóstico del costo de muchas hojas casi vacías; no es el perfil
  normativo P2 y no se le aplica su techo de 3.000 MB.

Se informa tiempo hasta Ready y OCR, M2 mediana/rango/máximo frío y caliente,
pico posterior a Ready separado, presión de memoria y asentamiento caliente.
Los crudos conservan también la serie RSS y presión por importación mediante
la proyección permitida del instrumento M-V1; no se vuelve a reducirlos a
los extremos de presión por tanda del registro compacto de M-O3. Esa
proyección excluye palabras, valores, URLs y cadenas arbitrarias antes de
escribir o releer. Las observaciones de transporte agregan solo cantidades,
confianzas, ángulos y hashes.
Además: páginas que entraron por la condición nueva, reconocimientos extra
y sus duraciones, y comparación por página de hashes, palabras, entidades
y avisos. Fuera de las páginas elegibles, no deben cambiar los despachos.
Orientación/tinta observadas deben ser naturales e idénticas a las entregadas.
Un fallo de importación es resultado de producto separado de medianas exitosas;
una incoherencia o guarda inválida deja la campaña incompleta.

Para conservar una importación terminada aunque falle el cierre o la siguiente,
`measureProfile` incorpora un callback opcional al final de su firma. Se llama
con el `RunReport` ya calculado de cada temperatura antes de cerrar el documento;
el caliente incluye el asentamiento observado. RC lo usa idéntico en A/RC
para retener su proyección en memoria. Los llamadores que lo omiten conservan
el comportamiento actual. No modifica `runImport`, samplers, cadencia ni
ventanas de medición, y una etapa conservada no acredita una corrida completa.

El aumento mediano de M2 se contrasta con el ruido de 345 MB y la superposición
de rangos. No se presenta una resta de medianas como aislamiento causal
perfecto ni se convierte una muestra de ruido en frecuencia de documentos.
Toda conclusión sigue provisional por el árbol sin commitear y por el candidato
experimental. La regla adoptada debe confirmar después estas mediciones.

## Orden y decisión posterior

M-V1 se interrumpió en su primera celda real porque el export requiere
resolver conflictos (ADR-176), paso que el instrumento no contemplaba. El
checkpoint de importación no acredita una copia exportada ni costo de lectura.
Se prioriza este arnés para responder la pregunta de costo del mantenedor;
M-V1 retoma después, con su preparación de conflictos documentada y nueva
identidad de arnés. No se ejecutan ambas campañas simultáneamente. El gate de
dos filas permanece preparado y se corre en otra tanda. Con el costo aislado,
el mantenedor aceptó RC y dejó SV/CP y su umbral abiertos. Ya se enmendaron
ADR-190 y el spec de OCR antes del código. La campaña de confirmación adopta
el orden indicado arriba; el resultado no autoriza commits, versión ni publicación.
