<!-- CONTEXT: scope=plan-ui | dependencias=ui/Components.md,ui/React_Client.md,core/Contracts.md,core/Render_Engine.md,core/Orchestrator.md,adr/ADR-199-Develop-Como-Rama-De-Integracion.md,adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md,adr/ADR-206-Una-Busqueda-Omitida-No-Confirma-La-Version.md | audiencia=humanos+IA | fase=11 -->

# Mejoras de interacción — 2026-10-05

Branch de trabajo: `codex/mejoras-interaccion-anonimizado`, creada desde
`develop` local (`8d562b9`). La primera ronda abarcó cliente React y pruebas
de su interfaz. La segunda, autorizada tras aceptar ADR-204/205, amplía
shared, Render y el façade para interacción anonimizada y corrige el export
en el cliente. No agrega dependencias externas.

**Estado al 2026-10-06:** los ocho cambios y los tres ajustes posteriores
están implementados. Sol aprobó el candidato completo contra `origin/develop`,
incluidos los archivos nuevos. El mantenedor autorizó commit, push y apertura
de PR a `develop` el 2026-10-06. La rama está publicada en el
[PR #53](https://github.com/sgiambelluca/Anonly/pull/53), abierto hacia `develop`.
El registro de implementación, revisión y
publicación está al final, incluido el cierre de foco del toast saliente.

## Especificación cerrada para implementación

Estas reglas complementan las secciones indicadas de `ui/Components.md` y
prevalecen para esta ronda. Las redacta el planificador antes del código.

1. **Toasts (§8.6).** Los avisos no persistentes duran 3000 ms. El siguiente
   sustituye inmediatamente al anterior, reiniciando su tiempo. Conservar
   los avisos persistentes de conflictos y sus acciones. La eliminación de
   entidad usa un tono propio `deletion`, con fondo y borde apenas rojos y
   un ícono de papelera; no tratar una eliminación exitosa como un error.
   Conservar Deshacer. Probar duración, sustitución y tono de eliminación.
2. **Actualizaciones (§2.6).** Tras la búsqueda manual y el evento real
   `update-not-available`, mostrar debajo de Versión instalada un círculo
   con tilde y «Estás utilizando la última versión.», en gris o verde.
   Reservar la altura del mensaje para evitar movimientos. Limpiar el mensaje
   al abrir Configuración y al iniciar otra búsqueda; no mostrar éxito ante
   errores, búsqueda pendiente o actualización disponible. No inferir éxito
   porque pasó tiempo. Usar el puente existente, sin nuevas suscripciones
   acumuladas al reabrir el diálogo. La confirmación está condicionada a que
   la plataforma emita el evento. Windows lo emite en `windows-updater.ts`
   y macOS en `native/src/sparkle_bridge.mm`; la ejecución local verifica
   Windows y la integración con el evento, sin afirmar validación nativa macOS.
   El adapter puede implementar `subscribeToUpdateEvents` mediante un relay
   por objeto `ShellUpdater` y listeners locales con unsubscribe. No ampliar
   IPC. El efecto del diálogo limpia su listener local al desmontarse; probar
   StrictMode y cambios entre pantalla de carga y trabajo. El toast de
   eliminación conserva una base opaca y añade encima el tinte rojo suave.
3. **Menú ⋯ (§3.5).** Reutilizar `resolveMenuPlacement` y la medición de
   límites de `ModeSelectMenu`: ventana intersectada con los ancestros que
   recortan. Medir el alto real, incluidas las opciones condicionales y el
   espacio entre disparador y menú. Abajo si entra; arriba si abajo no entra;
   lado con más espacio si ninguno alcanza. Conservar roles, nombres,
   selección y cierre. Probar la última fila y una fila superior en Electron.
4. **Select dentro de Dialog (§8.2/3).** Reproducir abrir Configuración,
   abrir un Select y hacer click en el cuerpo del mismo diálogo. Debe cerrarse
   solamente Select; el diálogo conserva sus datos y continúa abierto.
   Escape cierra primero Select; un Escape posterior cierra Dialog. El cierre
   explícito y el backdrop mantienen su comportamiento. Ajustar la integración
   local de Radix, sin listeners globales ni un nuevo gestor de capas. Si
   requiere una arquitectura compartida nueva, informar antes de implementarla.
   La reproducción en Electron localizó el bloqueo en el DismissableLayer de
   Select: el cuerpo de Dialog deja de recibir clicks y se alcanza el overlay
   de cierre. Se autoriza una integración local mediante contexto de Dialog
   y `onOpenChange` interno de Select para habilitar pointer events del padre
   solo mientras Select está abierto. No ampliar props públicas de Select ni
   alterar el bloqueo de otros modales; verificar confirmaciones anidadas.

## Segunda ronda autorizada — ADR-204 y ADR-205

Decisiones aceptadas por el mantenedor el 2026-10-05:
[ADR-204](../../adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md)
y [ADR-205](../../adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md).
Ambos tienen contratos y specs cerrados antes de delegar la implementación.

### Resaltado y selección por arrastre en anonimizado — factibilidad media/alta

El primer examen de la UI sugería separar el resaltado de la selección y
copiar el bbox original. La revisión del kernel descartó esa implementación
antes de realizarla: `tryRepaintLine` dibuja cada palabra vecina en
`neighborBbox.x + plan.delta` (ADR-058). La misma palabra visible puede tener
otra posición en el raster anonimizado. El rectángulo de la lupa quedaría
desalineado y el arrastre podría señalar otra palabra.

El overlay actual selecciona `Page.words` del original y está restringido a
original explícitamente por ADR-061/ADR-169. Los píxeles anonimizados no son
una nueva capa de palabras: reutilizar el overlay sin filtrado seleccionaría
texto escondido debajo de una etiqueta. No basta con cambiar el condicional.

ADR aceptado: producir un mapa de geometría visible junto al raster
anonimizado, desde el motor que conoce las métricas reales y el delta de
repintado, e identificar palabras originales que siguen visibles. Tanto la
lupa como el hit-test deben consumir ese mismo mapa para la revisión y escala
de preview vigentes. No duplicar la estimación de posiciones en React.
Seleccionar únicamente tramos visibles del original, excluyendo la geometría
realmente cubierta por reemplazos habilitados.
Las cajas y revisiones se especifican en Contracts, Data Model, Event System,
Render y Orchestrator. La política aceptada corta el arrastre en la primera
zona cubierta; comenzar sobre una etiqueta se ignora. La lupa señala la
etiqueta cuando la coincidencia está oculta. React_Client y Components
definen proyección, frescura, selección y revalidación. Validar original,
anonimizado, OCR, zoom, fragmentos, redact, cache y deshacer.

La siembra distingue registrar inputs de rasterizar páginas: preparar todas
las revisiones, pero renderizar anticipadamente solo páginas con reemplazos
o un preview ya solicitado. Las vacías nunca solicitadas conservan su carga
diferida, también después de OCR; refrescar en el mismo turno las solicitudes
en vuelo para descartar su generación anterior. Este contrato de
`preparePreviewInput` se cerró antes del ajuste de implementación que evita
renderizar todo el documento al alcanzar Ready.

### Reexportación después de editar — factibilidad alta, complejidad baja/media

`ExportDialog.shouldReopenOnResult` comprueba solamente si existe un blob.
`pipeline.store.exportResult` no registra a qué revisión del documento
pertenece. El resultado viejo sigue accesible, pero no es una prueba de que
refleje las ediciones actuales.

El humano propone simplificarlo con un boolean o contador, sin identificar
qué cambios hubo. El ADR-205 adopta un contador local del cliente:
`currentVersion` aumenta ante cambios; al solicitar exportar se captura ese
valor, y `EXPORT_FINISHED` lo guarda como `exportedVersion`. Deshacer también
incrementa: no se comparan hashes ni se intenta reconocer contenido idéntico.
No limpiar el contador incondicionalmente al terminar, porque se perdería
una edición ocurrida mientras se generaba el PDF. Alcance previsto: cliente
React y eventos existentes; no se extiende el contrato de export Core.
Cubrir altas,
bajas, modos, habilitación, reemplazos, conflictos, reglas, undo/redo y
reanálisis; zoom, búsqueda y orden de lista no invalidan el PDF. Un resultado
de otra revisión reabre el formulario con un aviso bajo el nombre:
«Ya exportaste este documento anteriormente. Hay cambios pendientes de
exportar.» Conservar `exportedVersion` aunque se invalide el blob: su valor
no nulo indica que hubo una exportación previa. El bridge observa grupos y
conflictos; las acciones observan reglas y reanálisis; history observa
restauraciones exitosas. Solo una solicitud UI pendiente, versión capturada
antes de emitir, y resultado asociado al documento activo. El Core conserva
la propiedad de sus blob URLs. Probar el ciclo completo.

### Secuencia de implementación de la segunda ronda

1. Tipos/exports compartidos y getter del façade conforme a Contracts.
2. Geometría del kernel, decoder, cache y evento de Render conforme al spec.
3. Revisiones por página y reanálisis vacío en Orchestrator.
4. Bridge/store, lupa y selección en anonimizado conforme a specs UI.
5. Contador, diálogo de export y observadores locales; pruebas de regresión.
6. Gates del lote y revisión independiente antes de declarar finalización.

El mismo Luna implementa secuencialmente todos los módulos; ningún otro
subagente trabaja en paralelo. No edita docs, no commitea ni publica. Si el
spec deja un caso sin definir, lo reporta al planificador antes de codificar.

## Validación y entrega

En la primera ronda el implementador Luna trabajó sobre cliente y E2E.
En la segunda trabaja sobre los módulos definidos arriba y los E2E
afectados, sin editar docs ni hacer commit/push. Ejecuta gates acotados y los
escenarios relevantes en Electron. El planificador registra resultados y
limitaciones; esta ronda no publica ni integra un PR. La revisión formal
pre-PR conserva los gates completos del repositorio.

## Resultado de implementación

En la primera ronda, Luna implementó los puntos 4 a 8 del pedido original: duración y sustitución
de toasts, tono de eliminación, confirmación de versión, dropup de ⋯ y cierre
del Select sin cerrar el popup padre. La segunda ronda implementó los puntos
1 a 3 con los ADR aceptados; su revisión final se registra debajo.

Validación del implementador, 2026-10-05:

- 39 pruebas unitarias dirigidas, TypeScript del cliente y de los E2E,
  ESLint acotado, Prettier y diff check: en verde.
- Builds nuevos del cliente y del shell de escritorio: en verde.
- 5 escenarios Electron: en verde, distribuidos en
  `group-context-menu-placement.spec.ts`, `select-inside-settings-dialog.spec.ts`
  (incluye confirmación anidada), `toast-interaction.spec.ts` y
  `update-check-feedback.spec.ts` (ventana estrecha, temas claro/oscuro,
  evento real del puente inyectado desde el shell).
- El fallo de cierre de Dialog se reprodujo antes del arreglo. La prueba de
  toast distingue la tarjeta visible del live-announcer oculto de Radix.
- Windows probado en runtime. macOS emite la señal desde el código de Sparkle;
  no se ejecutó runtime macOS ni se validó una descarga real de actualización.
- Cambios locales, sin commit, push ni PR. No se ejecutaron gates completos
del monorepo para una revisión pre-PR.

Revisión independiente de la primera ronda: **APPROVED**, sin hallazgos materiales.
El revisor inspeccionó diff, specs, E2E y la integración Radix/preload; no
repitió gates. El veredicto cubre los cinco ajustes implementados, no los
ADRs ni su implementación de la segunda ronda.

### Segunda ronda — implementación terminada, revisión final en curso

Luna implementó el mapa de geometría del preview anonimizado, su transporte
y cache junto al raster, revisiones por página en el Core y proyección en
el visor. La lupa señala texto visible o su etiqueta/bloque; click/arrastre
omite zonas cubiertas y corta la selección en la primera palabra cubierta.
La UI revalida la selección y descarta mapas de revisiones anteriores.

El contador de export captura la versión al iniciar el pedido. Reabrir sin
editar conserva el resultado y el nombre descargado; después de una edición
muestra el formulario con el aviso de exportación anterior. Ediciones durante
la generación siguen pendientes aunque el export finalice exitosamente.

El cierre incluyó dos correcciones de integración: el render full no pisa
el input del preview, y preparar metadatos de páginas vacías no las rasteriza.
El seed refresca las solicitudes previas o en vuelo y conserva carga diferida
en páginas vacías nunca solicitadas, incluso después de OCR.

Validación del implementador, 2026-10-05:

- Cliente React: 87 archivos y 1052 pruebas unitarias, en verde.
- RenderEngine: 8 archivos y 227 pruebas; façade Core: 3 archivos y 202
  pruebas, repetidas tras el último ajuste y en verde.
- Typechecks de los módulos afectados y E2E, ESLint y formato acotados,
  builds frescos de cliente/shell y diff check: en verde.
- Electron: anonimizado/lupa/arrastre y alta confirmada (1); exportar,
  descargar, reabrir, editar y reexportar (1); Select/Dialog (2); toast (1);
  dropup (1); actualizaciones (2). Todos en verde; el recorrido anonimizado
  se repitió después del último build. Los demás pasaron con el build limpio
  previo al ajuste interno de carga diferida.
- El arrastre E2E usa área positiva: el contrato existente rechaza rectángulos
  con altura cero. La regresión del original sigue cubierta por sus tests.
- Sin dependencias nuevas, commits, push ni PR. La verificación nativa de
  macOS sigue fuera del entorno disponible.

### Retoma y correcciones pendientes — 2026-10-06

La revisión final se interrumpió por límite de uso antes de emitir dictamen.
Sus gates globales dejaron lint, contratos (341 pruebas) y formato en verde.
Typecheck falló porque el E2E de actualizaciones usa `updateMode` y el tipo
`SettingsOverride` todavía no lo declara. La suite completa falló en
`multi-line-fragments.test.ts`: el mock de canvas de integración devuelve
solo `width`; faltan las métricas verticales usadas por la nueva geometría.
Completar esa frontera sin aflojar el decoder ni las assertions de dibujo.

La revisión confirmó que el helper anonimizado solo reconoce bandas
horizontales: dos palabras de una línea a 90° se seleccionan juntas en el
original pero no en anonimizado. Corregir línea/dirección conforme al spec,
incluidos ambos sentidos y el corte en tokens cubiertos a 90°/270°.

El planificador comprobó además incumplimientos del ADR-205 que deben cerrar:
limpiar el error anterior al solicitar exportar; invalidar el reanálisis
efectivo en su primera transición y limpiar selección/mapa, no al terminar;
no incrementar ante eventos obviamente idénticos o entidades ausentes;
contar el borrado implícito de una regla de grupo; usar el aviso acordado
y reiniciar la descarga local si llega un export nuevo con el panel montado.
Cubrir también cancelación antes del primer éxito y fallo después de una
exportación previa, sin dejar progreso perpetuo ni ocultar el error por
diferencia de versiones. Incluir los helpers puros nuevos en el gate de
cobertura, según la política vigente de CLAUDE y los thresholds del proyecto.

Se retoma el mismo implementador Luna para cerrar este pase. Al finalizar,
el mantenedor pidió un revisor Sol para evaluar el lote contra `develop`.
No existe todavía PR publicado, ni aprobación final, commit o push.

La retoma actualizó las referencias remotas: `origin/develop` está en
`c5711f6`. Su código y sus tests coinciden con la base local, pero incluye
avances documentales del cierre ADR-148/CI. Se conservaron mediante fusión
de contenido en el árbol de trabajo, sin mover HEAD ni modificar el índice,
para que la comparación final contra el remoto no revierta esos avances.

### Cierre del implementador en la retoma — 2026-10-06

Luna corrigió los pendientes anteriores y agregó regresiones para selección
rotada en ambos sentidos, corte vertical ante etiqueta, no-ops y eventos
inactivos, invalidación inmediata de reanálisis efectivo, error/reintento,
cancelación y reinicio del estado local de descarga.

- Cliente: 87 archivos y 1056 pruebas unitarias, en verde.
- Ocho suites de integración consumidoras del mock: 17 pruebas aprobadas y
  una `expected fail` declarada previamente por la política OCR vigente.
- TypeScript cliente y E2E, lint/formato acotados y diff check: en verde.
- Cobertura dirigida: `interactionProjection` 96% de líneas y 95,31% de
  ramas; `updateCheckState` 100%. Incluidos en los thresholds del proyecto.
- Builds frescos renderer/shell: en verde. El renderer conserva el aviso
  habitual de chunk superior a 500 KB.
- Electron tras ese build: anonimizado (1/1), exportación (1/1) y
  actualizaciones (2/2), ejecutados secuencialmente y en verde.

El revisor **Sol 6.1** evaluó el candidato contra `origin/develop` y emitió
**REJECTED** por tres cierres, pese a gates globales verdes:

1. El fallback centra la altura total de tinta en el mapa en lugar de usar
   baseline menos ascent y su transformación efectiva al rotar.
2. Historia compara snapshots JSON antes de incrementar; el ADR-205 exige
   incrementar tras toda restauración exitosa, sin equivalencia de contenido.
3. Faltan cuatro nombres y garantías normativas de Render y uno de
   Orchestrator; la prueba de revisión inválida solo comprueba −1.

Los resultados globales de esta revisión fueron: lint, typecheck, test con
cobertura, contratos y formato, exit 0. Tests: 233 suites aprobadas y 2
salteadas; 3656 pruebas aprobadas, una `expected fail` y 77 salteadas.
Contratos: 10 suites y 341 pruebas. Cobertura: 96,67% líneas y 85,75% ramas;
todos los thresholds configurados pasaron. La cobertura global dirigida de
`interactionProjection` fue 95,65% líneas y 94,74% ramas.

Se retoma Luna para corregir esas tres razones y completar las garantías
existentes, sin adaptar los requisitos a los tests actuales. Sol volverá a
revisar los cierres. La aprobación final sigue pendiente; no se publicó PR.

### Cierre de los tres rechazos — 2026-10-06

Luna corrigió el bbox fallback desde baseline/ascent/descent y transformó
sus cuatro esquinas para las rotaciones efectivas 90°/270°, sin cambiar el
dibujo ni la política existente de 180°. Historia incrementa después de
toda restauración exitosa, incluso con snapshot idéntico; comprueba el
documento activo antes de restaurar reglas y actualizar la versión.

Las pruebas normativas pendientes cubren tinta asimétrica, redact y
fragmentos multilínea; serialización del mapa por worker, miss/hit y evento;
revisión, escala, supersede y evicción; paridad del dibujo full con reemplazo
real y ausencia de mapa; revisión inválida NaN, ambos infinitos, negativo y
fracción en kernel/host/preparación, y cero explícito/default. Orchestrator
cubre las revisiones observables ante OCR y reanálisis que deja la página
vacía, conservando el caso lazy anterior. Undo/redo idénticos incrementan;
restauración fallida o pila vacía no incrementan.

Validación scoped del implementador:

- Render: 8 suites y 229 pruebas, en verde.
- Core façade e historia del cliente: 4 suites y 249 pruebas, en verde.
- Typecheck de render/Core/cliente, ESLint y Prettier scoped, diff check:
  en verde.
- Builds frescos renderer y desktop-shell: en verde, con el aviso habitual
  de chunk superior a 500 KB.
- E2E Electron anonimizado: 1/1, en verde; lupa, click bloqueado sobre
  etiqueta y arrastre visible que corta ante cobertura y agrega entidad.

Sol retoma la revisión de estos cierres, usando su pasada global previa y
repitiendo las verificaciones afectadas. El dictamen final sigue pendiente.

### Segundo dictamen de Sol — 2026-10-06

Sol cerró historia y los nombres/garantías normativas, pero emitió
**REJECTED** por un bloqueo residual: las esquinas del mapa usan signos
opuestos al giro realmente ejecutado en Canvas a 90°/270°. Su comprobación
con la matriz real de Canvas en Electron confirmó el desplazamiento con
tinta asimétrica. Las assertions nuevas repetían los mismos signos erróneos.

Se explicitó antes de retomar código el ángulo efectivo en Render_Engine:
90° usa −π/2; 270° usa +π/2. La regresión debe comparar contra la
transformación ejecutada al dibujar, sin modificar el paint ni full.

Verificaciones propias del revisor: 12 suites y 478 pruebas aprobadas;
cobertura scoped 96,64% líneas y 87,67% ramas, historia 100% líneas.
Typechecks render/Core/cliente, ESLint, Prettier y diff check: exit 0.
Se retoma el mismo Luna para cerrar este único defecto antes de la nueva
revisión de Sol. No se publicó PR.

### Cierre del giro residual — 2026-10-06

Luna usa la matriz con el mismo ángulo efectivo de Canvas para proyectar
las esquinas de tinta. La regresión captura `translate`/`rotate` del dibujo
y compara sus límites proyectados con el mapa para horizontal/90°/270°,
métricas asimétricas y escala 2. Pintado, full y 180° no cambiaron.

Render: 8 suites y 229 pruebas, en verde. Typecheck de Render, ESLint y
Prettier de kernel/tests y diff check: en verde. Builds frescos renderer y
shell y E2E anonimizado (1/1): en verde; solo aviso habitual de chunk grande.
El lote vuelve al mismo Sol para el dictamen final.

### Dictamen final — APPROVED, 2026-10-06

Sol aprobó el candidato completo contra `origin/develop`, incluidos los
untracked. Los tres rechazos originales y el giro residual están cerrados;
no hay hallazgos bloqueantes pendientes.

La reproducción propia del revisor con Canvas real confirmó coincidencia
entre tinta y mapa: izquierda 189,1875 a 90° y 189,8125 a 270°. La regresión
captura la transformación del pintado y detectaría los signos anteriores
con tinta asimétrica y escala 2. Horizontal, 180° y full conservaron su
comportamiento.

Última verificación propia de Sol: 38 pruebas del kernel, typecheck de
Render, ESLint, Prettier y diff check, en verde. Conserva la evidencia de
sus pasadas previas: 12 suites/478 pruebas, cobertura scoped 96,64% líneas
y 87,67% ramas, y cinco gates globales verdes (3656 pruebas aprobadas y
341 contratos). No repitió los gates globales por rutina; cada corrección
posterior tuvo comprobaciones afectadas y el E2E anonimizado con build
fresco del implementador.

Los ocho puntos de la campaña quedan implementados y revisados. La
aprobación corresponde al candidato local: no hay PR publicado ni commits
de esta campaña. Antes de publicar, separar commits por módulo y obtener
autorización explícita del mantenedor para commit/push (I-9). No se ejecutó
suite E2E completa, medición de rendimiento ni runtime nativo macOS; los
recorridos Electron afectados y sus resultados están registrados arriba.

### Ajustes reportados tras probar la app — 2026-10-06

1. Toast: salida inversa de su entrada, 260 ms, sin desmontarlo antes de
   finalizar; cierre lógico inmediato y reemplazo por otro aviso inmediato.
   Respetar reduced-motion y evitar que un cierre tardío borre el aviso nuevo.
2. Actualizador: `desktop-shell start` ejecuta una app sin empaquetar y el
   updater resuelve null sin eventos de resultado. ADR-206 especifica una
   respuesta `check-unavailable` visible, conservando la confirmación de
   última versión exclusivamente para una búsqueda real sin novedades.
3. Arrastre anonimizado: el código exige una palabra en el punto inicial,
   aunque el rectángulo abarque correctamente el texto. Enmendada ADR-204
   y Components antes de implementar: inicio en blanco usa renglón dominante
   y primer token tocado según dirección; inicio sobre texto/etiqueta conserva
   las reglas existentes. Sin ampliar las cajas o modificar el hit-test Core.

Reproducir el tercero con fixture sintético neutro: rectángulo que comienza
por encima/delante de un renglón y termina debajo/después, comparando ambas
vistas, ambos sentidos y corte ante cobertura. No incorporar la captura ni
texto/rutas de documentos reales al repositorio.

Se retoma el mismo Luna para el lote, después el mismo Sol. Gates scoped
cliente/shell y E2E afectados secuenciales: toast, actualizaciones y selección
anonimizada. El caso real de desarrollo debe recorrer IPC sin evento
inyectado; mantener separados los tests de éxito simulado. No forzar
configuración de actualización de desarrollo, descargas ni instalaciones.

### Implementación de los ajustes posteriores — 2026-10-06

Luna terminó los tres ajustes. ToastHost conserva la instancia saliente con
animación inversa de 260 ms, separada del dismiss lógico, y protege la instancia
nueva de callbacks viejos. El shell Windows informa la omisión y el diálogo
muestra su aviso. El arrastre desde blanco elige un ancla desde el rectángulo
y conserva las reglas de cobertura y dirección.

Validación scoped del implementador:

- Cliente React: 87 archivos, 1061 pruebas, en verde.
- Desktop shell: 19 archivos, 184 pruebas, en verde.
- Typechecks cliente/shell y E2E, ESLint scoped, Prettier y diff check: verde.
- Builds frescos renderer y shell: verde.
- Electron, specs secuenciales: toast 2/2; actualizaciones 3/3;
  anonimizado 2/2. Incluyen salida manual/programática/acción, reduced-motion,
  reemplazo y 3 segundos; botón/IPC real Windows sin empaquetar; mismo
  rectángulo desde blanco en original/anonimizado, ambos sentidos a 130%,
  conservando la prueba previa de corte y bloqueo de etiqueta.

El caso de Ctrl+Z enfoca un encabezado neutral antes del atajo: el campo
de archivo seguía enfocado tras importar y el producto ignora atajos de
historia en campos editables. No se alteró esa política del producto.
Sol retoma la revisión de la ronda adicional; dictamen pendiente.

### Revisión de los ajustes posteriores — REJECTED, 2026-10-06

Sol confirmó actualizador y ancla desde blanco, pero detectó un bloqueo:
el toast saliente conserva root y botones en el recorrido de teclado.
En Electron pudo cerrar el aviso, enfocar root/Deshacer con Tab y activar
Deshacer con Enter durante la salida, pese a aria-hidden y pointer-events-none.
Incumple la retirada de interacción de Components §8.6. Se explicitó foco y
teclado en esa regla y se retoma Luna para corregir y cubrir la secuencia.

Evidencia propia de Sol: 106 suites/1245 pruebas aprobadas; helper de
interacción 96,15% líneas y 93,33% ramas, helper de actualización 100%.
Typechecks cliente/shell/E2E, ESLint, Prettier y diff check: exit 0.
No encontró otros bloqueos; el dictamen final de la ronda sigue pendiente.

### Cierre de interacción del toast saliente — 2026-10-06

Luna retiró el root saliente del orden Tab, deshabilitó Action/Close y
retiró el foco si estaba dentro al cerrar. Conservó aria-hidden, Presence,
animación inversa, fallback de salida y protección por identidad.

Build fresco del renderer, typechecks cliente/E2E, ESLint scoped, Prettier
y diff check: en verde. E2E toast completo: 2/2; verifica tabindex −1,
controles deshabilitados, foco fuera tras Tab/Tab, Enter sin restauración y
Deshacer habilitado en el aviso que reemplaza al anterior.
Sol retoma este cierre para el dictamen final de la ronda adicional.

### Foco programático de Radix — cierre adicional, 2026-10-06

Sol confirmó acciones deshabilitadas y Enter sin ejecución, pero mantuvo
REJECTED: el primer Tab enfoca el LI cerrado porque Radix lo incluye en sus
candidatos y llama focus() aunque tenga tabindex −1. El segundo Tab sale;
la regresión que comprobaba solo después de ambos no detectaba ese intervalo.
Se especificó root DOM inert durante la salida, comprobaciones de cada Tab
y de focus() programático, y root nuevo/abierto interactivo. Se retoma Luna
únicamente para ese cierre. Tipos, lint, formato y diff check siguen verdes.

Luna aplicó inert nativo al root únicamente mientras sale, mediante
useLayoutEffect; el root abierto/reemplazante queda interactivo. E2E toast
completo 2/2 tras build fresco: focus() no entra al cerrado, foco fuera tras
cada Tab por separado, Enter no restaura y el reemplazante no está inert.
Cliente/E2E typechecks, lint y formato scoped y diff check: en verde.
Se retoma Sol para confirmar la retirada de foco y emitir el dictamen final.

### Dictamen final de ajustes posteriores — APPROVED, 2026-10-06

Sol aprobó los tres ajustes y el candidato local completo contra
`origin/develop`, incluidos los untracked. No quedan bloqueos pendientes.
Confirmó en Electron cada Tab y focus() sin foco saliente, controles
deshabilitados, retiro de foco previo tanto del root como de una acción,
aviso nuevo sin inert y Deshacer habilitado. Se conservan animación inversa,
plazo de tres segundos, reemplazo inmediato y reduced-motion.

Su verificación final propia fue E2E toast 2/2; typechecks cliente/E2E,
ESLint, Prettier y diff check, exit 0. Conserva su pasada de esta ronda de
106 suites/1245 pruebas, cobertura de interacción 96,15% líneas y 93,33%
ramas y helper updater 100%, más los gates globales previos. Los E2E del
implementador de actualizaciones (3/3) y anonimizado (2/2) siguen verdes;
los cierres posteriores solo modificaron toast y su regresión.

La ronda del feedback queda cerrada. No se publicaron commits, push ni PR;
siguen pendientes autorización I-9 y separación por módulo antes de publicar.
Sin E2E completo, mediciones de rendimiento ni runtime nativo macOS.

### Publicación autorizada — 2026-10-06

Después de APPROVED, el mantenedor pidió explícitamente commit, push y PR
contra develop. Se alineó la base de la rama con `origin/develop` (`c5711f6`):
el código era idéntico al develop local original y la documentación remota
ya estaba conservada en el árbol revisado. Una referencia de respaldo y hashes
de los 87 archivos modificados/nuevos confirmaron que alinear el historial
no cambió su contenido. El PR no arrastra los commits locales equivalentes
del cierre anterior de ADR-148. Los commits se separan por módulo.

### PR publicado — 2026-10-06

Se publicaron diez commits por módulo, desde `65da18e` hasta `c59b958`,
en `origin/codex/mejoras-interaccion-anonimizado`. Los hooks pasaron y
los hashes de los 63 archivos de código y tests coinciden con el candidato
aprobado por Sol; `git diff --check` también pasó. Se abrió el
[PR #53](https://github.com/sgiambelluca/Anonly/pull/53) hacia `develop`,
sin draft, y se adjuntó a esta tarea. CI y CodeQL estaban en ejecución
al abrirlo; la aprobación de Sol es la revisión local registrada arriba.
Este registro se incorpora en un commit documental posterior.
