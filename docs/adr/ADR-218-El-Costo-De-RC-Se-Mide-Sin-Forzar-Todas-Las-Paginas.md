<!-- CONTEXT: scope=adr-experimental | dependencias=adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,roadmap/ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md,roadmap/mediciones/ocr/Costo_De_Verificar_Cuatro_Angulos_2026-10-09.md,core/OCR_Engine.md | audiencia=planificador+implementador+revisor | fase=12 -->

# ADR-218 — El costo de RC se mide sin forzar todas las páginas

- **Estado:** decisión técnica de instrumentación del planificador; smoke
  8/8 válido y campaña experimental de costo 12/12 válida, provisional. RC
  aceptado por el humano el 2026-10-10; confirmación adoptada con smoke 8/8
  y costo 12/12 válidos, provisional. SV/CP diferido por el humano hasta
  disponer de más documentos/escaneos; no se adopta un umbral.
- **Fecha:** 2026-10-10.
- **Origen:** al pedir decisión después de M-O3, el mantenedor pregunta si el
  tiempo extra es excesivo y con qué frecuencia ocurriría el fallback de ruido.
  Su respuesta no se interpreta como aceptación de la regla ni del costo.
- **Alcance:** arnés de medición y builds experimentales aislados. Sin cambios
  de fuentes de producto, contratos, presupuestos ni comportamiento publicado.

## Contexto

M-O3 es el peor caso de cuatro lecturas en todo el documento. Su factor de
tiempo de 3,4–4,4 y el aumento frío de 444,6 MB en P2N no son el costo
aislado de reintentar unas pocas hojas casi vacías. La simulación de M-O2
estima uno a seis segundos extra por hoja de ruido. La condición candidata
RC se cumple en una de las 20 páginas del escaneo R1 y ninguna de las 61
páginas digitales rasterizadas de R2–R4. Este corpus no estima una frecuencia
poblacional y no incluye escaneos malos reales.

## Decisión experimental

1. Comparar el control actual A con RC aislado. El único cambio candidato
   amplía la rama de páginas enteras sin veredicto OSD con primera lectura
   vacía y tinta real mayor que cero. No se cambia tinta, veredicto, resultados,
   aviso, DPI, regiones, SV ni comparador fuera de esa rama. Esta rama prueba
   los tres ángulos faltantes una vez y no hace upscale.
2. Mantener intactos `packages/` y `apps/`. Un plugin Vite del arnés transforma
   durante el build RC una única coincidencia exacta del predicado de
   `ocr.engine.ts`. A usa la misma configuración con transformación desactivada.
   Cero o múltiples coincidencias abortan; no se aplica un reemplazo aproximado.
3. Congelar dos artefactos empaquetados. Registrar hashes de fuente original,
   fuente transformada, plugin/config, dist de cada brazo y las identidades
   normales de producto, arnés, assets y fixtures. Restaurar los dist previos
   al cerrar y comprobar sus hashes. No medir junto con M-V1 ni otra suite.
4. Validar transparencia del control y alcance exacto del transformador.
   El build RC debe recuperar los cuatro N1 naturales de 150/300 dpi y
   giros 90/270; controlar blanco y ruido sin cambiar fixtures. Un candidato
   que no ejecuta la regla exacta no aporta evidencia de su costo.
5. Medir R1 y el P2N exacto de M-O3, A/RC intercalados, tres repeticiones
   frías/calientes, nivel `medium`, NER activo e instrumento M2 vigente.
   Guardar solo la proyección permitida de métricas, cantidades y hashes.
   Mantener natural la orientación y la tinta en ambos brazos; comprobar
   que solo las páginas elegibles reciben reconocimientos nuevos.
6. Informar tiempo y M2 frío/caliente, rangos y máximos, pico posterior a
   Ready separado, presión, entregas y fallas. P2N no tiene el techo de P2.
   El ruido de referencia de 345 MB y rangos superpuestos limitan la
   atribución de diferencias. Los resultados son provisionales.

## Cierre

El protocolo completo está en
[Costo_RC_Aislado_Protocolo_2026-10-10.md](../roadmap/ocr/Costo_RC_Aislado_Protocolo_2026-10-10.md).
La revisión debe distinguir fidelidad del candidato, validez del instrumento
y costo observado de aceptación de producto. Después de los resultados, el
humano decide RC y separadamente SV/CP. Solo entonces se enmiendan ADR-190
y el spec OCR y se implementa la regla adoptada. No se publica el build
experimental ni se habilita una opción nueva de usuario. No autoriza commits.

**Resultado registrado el 2026-10-10:** las doce corridas fueron válidas,
sin cambios de entregas. En R1 la mediana hasta Ready aumentó 0,394/1,022 s
(frío/caliente), con diferencia M2 dentro del ruido; diez hojas de ruido en
P2N agregaron 19,884/19,112 s y +455,9/+404,8 MB al pico mediano. La presión
del sistema no estuvo disponible y la frecuencia en documentos reales sigue
sin estimarse. Ver [informe del costo aislado](../roadmap/mediciones/ocr/Costo_RC_Aislado_2026-10-10.md).
**Decisión humana posterior (2026-10-10):** «Sí, incorporar RC y decidir
SV + CP después». ADR-190 y `OCR_Engine.md` v1.18.0 especifican la regla
adoptada antes del código. El experimento anterior conserva su identidad
y carácter provisional; no sustituye la validación del producto implementado.

## Confirmación sobre la implementación adoptada

El arnés incorpora un modo explícito `ANONLY_RC_SOURCE_MODE=adopted`,
separado del modo histórico `experimental` (valor predeterminado). No
infiere el modo por semejanza de la fuente. Fuentes y artefactos de cada
modo se miden en carpetas nuevas; nunca se mezclan sus medianas.

En `experimental`, A conserva la fuente original byte por byte y RC agrega
la cláusula. En `adopted`, **RC conserva la fuente de producto byte por
byte** y A quita solamente la cláusula RC durante su build. El plugin
transforma el brazo cuyo resultado difiere de la fuente; no presupone que
ese brazo es RC. El árbol compartido permanece intacto.

Ambos modos validan una sola coincidencia exacta del predicado y su contexto
de página entera sin veredicto. Cero, múltiples, mixtas o alteradas abortan;
no se utiliza un reemplazo aproximado. El modo es una enumeración cerrada,
registrada en las identidades de build y transformación y comprobada en
ambos brazos al inicio y al cierre. Las pruebas puras exigen identidad de
RC en `adopted`, cambio exclusivamente de la cláusula en A y rechazo de
modo/fuente no admitidos. Las pruebas históricas de `experimental` se conservan.

Antes de medir, comprobar fuera de las ventanas que el renderer RC adoptado
es idéntico al build normal recién producido con la misma configuración,
`VITE_E2E=1` y opciones. No hay otra transformación de producto. Repetir el
smoke de ocho corridas (cuatro N1 naturales y controles blanco/ruido), luego
las doce corridas de costo con R1 y P2N exactos de M-O3, sin modificar fixtures.
Se mantienen aislamiento, privacidad, guardas, proyección y restauración.
El informe compara A/RC de esta campaña nueva y separa los resultados
experimentales anteriores. La falta de presión disponible no se convierte
en presión cero ni estable. Este trabajo no autoriza commits o publicación.

## Resultado de la confirmación adoptada

**Confirmación registrada el 2026-10-10:** modo `adopted`, smoke 8/8 y
costo 12/12 válidos, auditados sin mezclar las campañas experimentales.
R1 aumentó 1,185/0,952 s hasta Ready; P2N, 19,452/18,713 s. M2 de R1
quedó dentro del ruido; en P2N frío aumentó 470,8 MB con rangos separados
y caliente 351,5 MB con rangos superpuestos. Presión por importación
no disponible en las 24 ventanas. Fuente/renderer RC normal idénticos,
guardas positivas, sin suspensión y ambos dist restaurados. El
[informe](../roadmap/mediciones/ocr/Costo_RC_Aislado_2026-10-10.md)
conserva los crudos, rangos y limitaciones. Árbol sin commitear: provisional.
M-O1 completó 700/700 observaciones, sin incoherencias inesperadas. Falta
la repetición requerida sobre el commit antes del release. La revisión
integral fue APPROVED para PR por Sol el 2026-10-11;
SV/CP permanece abierto técnicamente y fue diferido por el humano hasta
disponer de más escaneos, según la
[decisión de retoma](../roadmap/ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).

## Alternativas descartadas para medir

- Atribuir a RC el peor caso de M-O3: fuerza también todas las páginas con
  texto y altera los avisos al elevar la tinta en C.
- Bajar el umbral de tinta del instrumento: cambia el aviso y puede entrar
  en un upscale que la regla candidata no ejecutaría.
- Cambiar temporalmente las fuentes del árbol compartido: dificulta proteger
  la identidad de M-V1 y los cambios previos del mantenedor.
- Estimar memoria sumando tiempos de M-O2: esos tiempos no miden un pico M2.
