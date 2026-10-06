<!-- CONTEXT: scope=roadmap-experimento-ocr | dependencias=adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,adr/ADR-065-OCR-Por-Region.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,core/Contracts.md,core/PDF_Engine.md,core/OCR_Engine.md,core/Regex_Engine.md,core/NER_Engine.md,core/Render_Engine.md,roadmap/mediciones/ocr/Regiones_Pequenas_2026-10-05.md,tests/perf/README.md | audiencia=humanos+IA | fase=12 -->

# Mínimo de 25 pt — experimento de admisión y pipeline

> **Cierre posterior ADR-203:** para completar el gate de export se vuelve
> a 100 pt en el workspace, conservando los snapshots 100/25 y la variante
> pequeña en un builder explícito. Este plan es registro del experimento
> concluido, no una orden de volver a activar 25 pt. No se adopta el candidato.

**Estado (2026-10-05):** piloto cerrado por Luna con parada temprana:
mixed recuperado, H2 refutada por tres ejecuciones OCR en capas alineadas.
Sol 6.1 aprobó fidelidad, arnés y evidencia después de cerrar tres defectos
mecánicos; rechaza adopción bajo los criterios actuales. H3 ampliada/H4 no ejecutadas conforme
al criterio de parada. [Informe](../mediciones/ocr/Regiones_Pequenas_25pt_2026-10-05.md).
Prototipo local de ADR-202, no política de publicación.
Implementador Luna y revisor Sol 6.1, retomando los mismos agentes.

## Alcance y entregables

Cambiar únicamente la constante del mínimo por lado en `pdf-engine`
de 100 a 25, con comentario ADR-202 y pruebas de §14 del spec. El mínimo
se aplica al bbox clampeado. Los filtros de ADR-065 y todo otro runtime
se conservan. Trabajo de tests/perf y PDF Engine separado por módulo
para una eventual partición de commits; no commitear ni editar docs.

Entregar fuente/diff del candidato, identidad de builds/fixtures,
observaciones por caso, originales y exports verificados, series de
costo si pasa la primera etapa y conclusión de cada hipótesis. Un
contraejemplo válido se conserva, no se arregla alterando el fixture.

## 1. Preparación e identidad de ambos brazos

Antes de cambiar la constante, construir renderer con `VITE_E2E=1` y
shell desde el workspace actual, conservando los cambios ADR-148 y del
arnés que aún no están commiteados. Verificar la constante de 100 pt.
Guardar artefacto **inmutable de referencia** y manifiesto con hashes de
source/runtime, shell, renderer, modelos y versión de instrumentos.

Después construir/snapshotear el candidato de 25 pt. No usar `git reset`,
checkout de otros cambios ni reconstrucciones dentro de una ventana de
medición. `git diff` debe mostrar que el único cambio de runtime respecto
a la referencia es esa constante y su comentario. Guardar patch/hash.

Arnés propio opt-in `tests/perf/ocr-region-25pt-prototype.spec.ts`, sin
agregarlo a gates cotidianos. Puede reutilizar helpers existentes. Puede
elegir artefactos **desde tests**, sin introducir un override al producto:
launch Electron sobre dos snapshots con la estructura relativa del shell
y renderer intacta. Mantener el ejecutable Electron real del workspace;
si el shell necesita resolver dependencias, usar una junction de tests
a su node_modules existente, sin copiar ni modificar las dependencias.
Registrar targets resueltos y verificar que estén dentro del workspace/
directorio de campaña. Ningún borrado recursivo de junctions.

Generar fixtures antes de abrir los procesos medidos. Misma secuencia de
bytes/hash en ambos brazos. Solo un gate o medición pesado a la vez.
Comandos largos esperan finalización real en una llamada/aviso; sin
sondeos reiterados ni final que dé por terminado un comando pendiente.

## 2. Primera etapa: controles que pueden refutar el mínimo aislado

Ejecutar sobre referencia y candidato, con Intermedio/NER real y assets
locales. Observar regiones retenidas, requiresOCR, eventos, Word[] y
grupos/miembros del documento. Capturar ocurrencias reales, tipo, valor,
origen y página; contar falsos positivos por ocurrencia, no solo grupos.
La candidata descartada sigue siendo interna; no inventar su geometría
ni una causa única desde la caja del fixture.

| Control | Qué comprobar |
| --- | --- |
| Mixed original 300 × 56 pt de ADR-148 | Misma fuente, ambos DNI legibles; referencia excluye la imagen. Candidato retiene una región y detecta el DNI de imagen. Export real por UI: DNI originales ausentes, vecinos presentes y control sensible del verificador válido |
| 12 capas alineadas del corpus adicional ya medido | Fuente/imagen alineadas sin alterar fuente, cuerpo u orientación. Referencia y candidato deben conservar cero regiones/eventos OCR nuevos; texto y grupos nativos siguen presentes |
| Cohorte histórica de 17 pequeños con original confirmado | Mismo caseId/hash de imagen. Reportar admisión, lectura y entidad del producto por separado; no usar aciertos forzados anteriores como aciertos del nuevo pipeline |
| Tres controles sensible/neutral/blanco | Mismos bytes por brazo. Leer fuente independientemente antes de afirmar recuperación; observar el ADDRESS espurio del neutral y el texto espurio del blanco como resultados diferentes. No llamar falso positivo al texto neutral esperado |
| Bordes 25 y 24,99 pt, ambos ejes | Área de imagen ≥1%, sin ocupación nativa encima. Acepta caja clampeada de 25; rechaza el lado inferior. Si clamp reduce un lado, decide el bbox real, no el tamaño nominal |
| Imágenes históricas 40 × 25 pt | Se conserva exclusión por área <1%; reducir el mínimo no implica admisión |

Usar lectura independiente fuera de Electron medido, original + archivo
final + vecinos/sensibilidad según ADR-148. No inyectar grupos o palabras
para producir un export de candidato. Nunca contabilizar operación no
ejecutada como miss; originales no confirmados son inconclusos. Conservar
resultados negativos antes de cualquier aserción terminal del arnés.

**Parada temprana:** si el cambio fiel de constante dispara OCR en los
controles alineados, no admite el mixed por otro filtro, o no conserva
su sustitución/vecinos con fuente confirmada, entregar evidencia y parar
la campaña larga. No modificar filtros ni otros motores. Los checks
mecánicos y una revisión independiente de ese contraejemplo sí se hacen.
El falso positivo conocido de NER se cuantifica y se reporta; no se
silencia ni se transforma en un fix de NER dentro de esta tarea.

## 3. Calidad ampliada si la primera etapa sostiene la hipótesis

Reutilizar corpus histórico 175 páginas (hash e491289b…) en ambos brazos.
Conservar etiqueta de los overlays desalineados: no prueban redundancia.
Unir fuentes confirmadas por caseId + hash, mantener los inconclusos y
denominadores solo de operaciones realmente ejecutadas. Añadir únicamente
controles versionados cuando falte verdad necesaria; no mutar históricos.

Medir admisión, texto, entidades y duplicados por página, grupos/miembros,
FP sensibles/neutral/blanco, además de export final. Reportar delta de
ocurrencias del candidato frente a referencia. Una entidad nueva sobre
texto neutral cuenta como sustitución innecesaria aunque el grupo ya
existiera en otra página. No extrapolar tres controles al corpus entero.

## 4. Costo del pipeline completo, sujeto a primera etapa

Dos brazos sobre cuatro perfiles sintéticos nuevos o reutilizados:

- 1, 10 y 50 bandas de 300 × 56 pt, una por página (fixtures de carga
  históricos con hashes conservados).
- 50 imágenes **elegibles por área**, en una página: corpus adicional
  de 220 × 25 pt, dos columnas y 25 filas, huecos que mantengan todo
  dentro de A4 y texto nativo fuera de sus cajas. Cada imagen ocupa
  aproximadamente 1,098% de la página. No reemplaza los controles de
  40 × 25 pt (0,2%); ambos tienen nombre/versión propios.

En el último perfil, el producto sigue reteniendo **como máximo una**
región. Registrar cuál, píxeles y texto/entidades; no afirmar que OCR
procesó las 50 ni que su costo es comparable por conteo con 50 páginas.
Las imágenes no seleccionadas siguen siendo limitación de ADR-065.

Tres rondas que roten los cuatro perfiles y alternen A/B y B/A por par,
24 series en total; cada serie importa en frío y en reapertura dentro
de la misma instancia, renderiza todas las páginas anonimizadas, descarga
por UI y registra 30 s de reposo. Workers se liberan conforme al lifecycle
real; caliente no significa modelo OCR residente. Sin OCR forzado en
estas mediciones. Registro de orden desde timestamps de los raws, no
desde una lista declarativa. Cada par usa mismo hash de fixture.

Registrar por brazo y perfil: Ready, tiempo/eventos OCR reales, regiones,
píxeles del recorte a 300 dpi, número de grupos/miembros, RSS del árbol,
heap, import/render/export/reposo, tiempo total/archivo exportado. RSS
150 ms, heap CDP 1000 ms con GC forzado explicitado. Mediana/rango y
máximos, bytes y MB decimales. Dos brazos con misma instrumentación;
no sumar resultados OCR aislados previos como predicción o delta.

Verificación Node/Chromium fuera de ventanas de memoria. Windows presión
indisponible se conserva; freemem es solo observación del host. Una fase
sin muestra es null con causa. Guardar runs abortados aparte, no como
repetición válida ni cero; no sobrescribir evidencias anteriores.

## 5. Presupuestos y gates

Los perfiles sintéticos no son P1/P2 de ADR-192. Si se completa el costo
y el candidato sigue siendo defendible, medir P1 y P2 canónicos sobre el
build candidato, tres repeticiones frías/calientes Windows Intermedio,
sin otras cargas. Reportar máximo frente a 2,0 GB/3,0 GB respectivamente.
No crear un nuevo techo para las bandas, ni declarar cumplimiento por
compararlas con el presupuesto de otro perfil.

Luna: Prettier/ESLint/typecheck scoped, tests PDF Engine (contract/unit/
edge y cobertura normativa) y regresiones discriminantes del arnés. No
cambiar snapshots/expectativas para ocultar una regresión.

Sol: revisión final por lote y checks scoped de primera mano. No repetir
campañas sin una duda concreta. Si el candidato supera la primera etapa,
verificar el caso mixed en ADR-148 y, si procede, las 21 filas sin skips
una vez sobre ese build. Un resultado de candidato no aprueba publicación
ni política. R-16 global y aprobación de merge quedan para una propuesta
de adopción, no para este experimento local que puede quedar rechazado.

## 6. Coordinación y conclusión

Root escribe docs y decide arquitectura. Luna implementa/ejecuta y entrega
final con evidencia y conclusión, luego Root retoma automáticamente a
Sol. Un subagente activo a la vez; esperar avisos sin pedir que el humano
notifique finalizaciones. Hallazgos mecánicos vuelven a Luna. Una política
fallida fiel al spec vuelve al planificador/humano, no a un fix improvisado.

Informe final: H1 mixed/recuperación, H2 exclusión nativa, H3 precisión de
entidades y H4 costo real, cada uno confirmado/rechazado/inconcluso. Si
una parada temprana evita la campaña, declarar costo no medido y explicar
el contraejemplo. El humano decide adopción, revisión de diseño o mantener
100 pt; los presupuestos y ADR-148 conservan su estado hasta evidencia
y decisión explícitas. Ningún commit, push, merge ni publicación.
