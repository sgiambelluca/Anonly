<!-- CONTEXT: scope=roadmap-1.x | dependencias=roadmap/Version_1.0.md,roadmap/Version_2.0.md,roadmap/Future_Ideas.md,roadmap/hitos/Post_Hito10.8_Pendientes.md,RELEASING.md,00_Project_Vision.md,architecture/08_Security_Model.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md | audiencia=humanos+IA | fase=12 -->

# Anonly — Roadmap 1.x

> Qué sigue después de la 1.0, en qué orden y con qué criterio se numera.
> Decidido por el humano el 2026-10-02. Es el documento que manda para
> planificar; `MVP.md` queda como registro histórico.

Cada versión de este roadmap arranca igual que un hito: el planificador
audita, escribe los ADR y los specs, y recién después se implementa. **Las
secciones «Para decidir al llegar» listan lo que ya se sabe que hay que
resolver; no son decisiones tomadas.**

## 1. Cómo se numera

| Tipo | Cuándo |
|---|---|
| Parche (`1.0.x`) | Arreglos. También toda corrección de detección o de export que tape algo que antes se escapaba |
| Menor (`1.x.0`) | Una capacidad nueva que el usuario ve |
| Mayor (`2.0`) | Un cambio que le rompe la costumbre o el equipo al usuario: otro contenedor, subir el equipo mínimo, cambios de flujo |

## 2. Cómo se publica

- **Por tema cerrado, no por fecha.** Una versión menor sale cuando su tema
  está completo. Un parche sale cuando hay algo que arreglar.
- **Una fuga de dato se publica como parche apenas está arreglada**, sin
  esperar al resto de la versión.
- **Solo se mantiene la última versión.** Sin ramas de mantenimiento: un
  problema de la 1.1 se arregla en la 1.1.1.
- **Antes de cada tag**: el subset de gates en verde y la corrida de prueba de
  `release.yml`. La suite pesada (`test:e2e`, `test:perf`, `test:leak`,
  `test:stress`) se corre en las versiones menores y cuando el cambio toca
  motores.
- **Las notas de cada versión** llevan una sección fija de limitaciones
  conocidas. Cuando cambia la detección, lo dicen: el mismo documento puede
  dar un resultado distinto que en la versión anterior.
- **Pre-releases** (`v1.1.0-beta.1`) para probar un instalador. Falta
  confirmar que el actualizador de una versión estable las ignora, antes de
  usar ese canal.

**De la 0.9.2 a la 1.0.0.** La 0.9.2 se publicó marcada como pre-release en
GitHub, pero su número no lleva sufijo. Por eso su actualizador consulta la
última versión **estable**: `releases/latest` en Windows (`electron-updater`
sin `allowPrerelease`) y `releases/latest/download/appcast.xml` en macOS
(Sparkle). Hoy esa consulta no encuentra nada, porque no hay ninguna versión
estable. Al publicar la 1.0.0 como estable, la encuentra y la instala desde la
aplicación, verificando la firma con las mismas claves (ADR-131, ADR-137).
Conserva la configuración del usuario.

**Probado el 2026-10-02**, al publicar la 1.0.0: una 0.9.2 instalada en
Windows la encontró, la bajó y se actualizó, después de corregir a mano el
nombre del instalador en el release (ADR-198). En macOS no se probó.

## 2bis. 1.0.1 — Actualizaciones

Salió de publicar la 1.0.0 y actualizar una 0.9.2 de verdad.

- **El instalador de Windows se publica con el nombre que dice su
  manifiesto** (ADR-198). En la 1.0.0 la actualización desde la aplicación
  fallaba por un nombre de archivo distinto; se arregló a mano en el release.
- **Aviso de descarga con porcentaje, instalación sin asistente, y
  «Instalar automáticamente» instala al cerrar la aplicación** (ADR-197).
- **Recuperación si la instalación se corta** (ADR-197 §5): se vuelve a
  verificar el instalador antes de usarlo, y Windows lo vuelve a correr en el
  próximo inicio de sesión si no terminó.
- **El test de fugas corre sus tres casos en paralelo en CI**, y su regla de
  workers deja de depender de una sola muestra (ADR-185, enmienda del
  2026-10-02).

**Pendiente de decidir o de verificar**

- macOS: «Instalar automáticamente» instala **al abrir** la aplicación, no
  al cerrarla (ADR-197 §6, decisión del humano). Sin probar: hace falta una
  Mac.
- La instalación por los dos caminos (botón y cierre) se probó el
  2026-10-02 en Windows con un build de prueba (ADR-197, «Cómo se
  verifica»). Falta ver que el instalador de la 1.0.1 borre la entrada de
  recuperación al terminar: eso recién se puede ver en la actualización
  siguiente a la 1.0.1.
- El corte real de una instalación no se probó (ADR-197, «Cómo se
  verifica»): se hace a mano en una máquina virtual.
- El comportamiento nuevo se estrena en la actualización **siguiente** a la
  1.0.1: la de la 1.0.0 a la 1.0.1 la ejecuta el código de la 1.0.0.

## 3. 1.0.x — Confianza

Lo primero, porque es lo que permite tocar la detección sin miedo.

- **Gate que lee el PDF exportado** (ADR-148, primera entrega sin aprobar):
  abre el archivo exportado, lo convierte en imagen y le pasa OCR. Es trabajo
  de tests; no cambia el producto. **Auditado el 2026-10-05:** documentación
  lista para implementar en
  [Export_Verificado_ADR148_Plan.md](hardening/Export_Verificado_ADR148_Plan.md), con
  corpus, comparación, matriz mínima y CI definidos. Primera implementación
  entregada inicialmente **sin aprobar**: 20/21 en Windows, cero salteados; correcciones
  mecánicas del arnés cerradas, política del caso mixto pendiente. Ver
  [la revisión](hardening/ADR148_Revision_2026-10-05.md). CI/macOS no verificada.
  **Primera revisión independiente Sol 6.1: REJECTED.** El fixture mixto contradice
  el mínimo por lado de ADR-065. El humano decidió el 2026-10-05 investigar
  imágenes pequeñas en una tarea propia con calidad y memoria:
  [plan de investigación](ocr/Regiones_Pequenas_Investigacion_Plan.md).
  Las mediciones del producto actual y del OCR aislado quedaron registradas
  en [el informe](mediciones/ocr/Regiones_Pequenas_2026-10-05.md). Sol 6.1
  aprobó la caracterización limitada y el arnés; candidato experimental
  de 25 pt autorizado por el humano para investigar. ADR-202 y spec
  experimental listos en el
  [plan de 25 pt](ocr/Regiones_Pequenas_25pt_Experimento_Plan.md).
  El piloto recuperó el mixed pero refutó la exclusión de OCR redundante
  en tres capas alineadas; campaña larga detenida. Sol aprobó fidelidad,
  arnés y evidencia; adopción bajo los criterios actuales rechazada.
  Ver [resultado del piloto](mediciones/ocr/Regiones_Pequenas_25pt_2026-10-05.md).
  La adopción del umbral quedó rechazada bajo esos criterios. La fila mixed
  original quedó bloqueada en esa ronda; la corrección del corpus se decidió
  por separado en ADR-203.
  **Ronda de cierre ADR-203 autorizada:** mantener 100 pt, versionar un
  mixed elegible de 300 × 125 pt y preservar el de 300 × 56 pt en
  caracterización. **Cierre local: 21/21 en Windows, cero fallos/salteados,
  R-16 verde y Sol 6.1 APPROVED.** CI remota pendiente sobre el ref publicado;
  el humano autorizó commit y push en develop. Ver
  [evidencia y revisión final](hardening/ADR148_Cierre_ADR203_2026-10-05.md).
- **«Validar muestra»**: la misma comprobación, al alcance del usuario.
  Después de exportar, la aplicación vuelve a leer el PDF exportado y
  comprueba que no queda ningún valor original (`Future_Ideas.md` §5.3).

  **Para decidir al llegar**: ADR-148 decide el gate de tests, no esta
  función. La versión para el usuario es una capacidad visible, así que lleva
  su propia decisión: dónde se ofrece, qué muestra cuando encuentra algo, y
  cuánto tarda sobre un documento largo. Por el criterio de §1 sale en una
  versión menor, aunque se trabaje dentro de este bloque.
- **Emails en escaneos de baja resolución**: investigar la causa
  (`MVP.md`, Hito 11, ítem abierto del 2026-10-01).
- **Página escasa y girada** (riesgo aceptado de ADR-190): recalibrar el
  criterio de lectura fiable o verificar ángulos en páginas escasas.
- **Direcciones**: 0 de 4 en la línea de base de calidad.
- **Firma de Windows con SignPath**: cuando llegue la aprobación
  (`SignPath_Postulacion.md` §5, que pide su ADR). No condiciona ninguna
  versión.
- **Memoria**: medir el techo del perfil Bajo en Windows (ADR-194 §7) y
  repetir M2, cuyo margen en P2 es menor que el ruido.

## 4. 1.1 — Detección a medida del usuario

- **Patrones Regex propios**: interfaz para crear, editar y borrar patrones,
  con prueba en vivo. El motor ya expone `addPattern` y `removePattern`
  (`core/Regex_Engine.md` §6).
- **Tipos de entidad definidos por el usuario**: nombre propio y formato de
  marcador.
- **Filtros en el árbol de entidades y búsqueda con regex** en el árbol.
- **Panel de ayuda de atajos de teclado.**
- **Tooltips enriquecidos en el visor**: valor original, modo, tipo y
  cantidad de apariciones.

**Para decidir al llegar**

- Dónde se guardan los patrones del usuario y si se pueden exportar e
  importar.
- Un patrón mal escrito puede colgar el análisis. El email por defecto ya
  necesitó un escáner lineal (ADR-181). Hay que decidir cómo se acota un
  patrón del usuario.
- La guarda de corrida de ADR-075 §2 también se aplica a los patrones del
  usuario (`Future_Ideas.md` §5.8).
- Qué es el valor sintético de un tipo definido por el usuario
  (`Future_Ideas.md` §5.5). Hoy es un texto de relleno.

## 5. 1.2 — Varios documentos

- **Cola de varios PDF**, procesados de a uno.
- **Pausa y reanudación** del análisis.
- **Prueba de WebGPU para el modelo de NER.** Es una campaña de medición: se
  adopta solo si los números lo justifican, con respaldo en WASM.
- **Recall y precisión de NER como gate**, en la misma campaña de medición.
  Recall es qué porcentaje de las entidades reales detecta el modelo;
  precisión, qué porcentaje de lo que detecta es correcto. Como gate, una
  versión no se publica si baja de un umbral. Hoy se mide y se informa, sin
  bloquear.

**Para decidir al llegar**

- Qué se conserva en memoria de cada documento de la cola, y cómo convive con
  los techos por perfil (ADR-192, ADR-194).
- Cómo se revisa y se exporta cada documento de la cola: de a uno, o todos
  con la misma configuración.
- Qué significa pausar en cada etapa. Hoy cancelar conserva las ediciones
  (ADR-038); pausar es otra cosa.
- El gate de NER necesita un conjunto de referencia que lo sostenga: el
  actual tiene 78 entidades en 26 documentos sintéticos. Hay que decidir el
  umbral y si el conjunto alcanza.
- WebGPU: la medición de hilos de NER dio resultados opuestos en macOS y en
  Windows (`mediciones/ner/Hilos_NER_Medicion.md`). La de WebGPU también
  puede depender del equipo, y tocaría los perfiles.

## 6. 1.3 — Otros formatos

- **Word (`.docx`)**: entrada y salida. Es el primer paso.
- **Imágenes sueltas, Excel y PowerPoint** como entrada.
- **El formato de salida se elige en el diálogo de exportar.**
- **Export con texto preservado**: un PDF donde el texto no sensible sigue
  siendo seleccionable y buscable, en lugar de una imagen.
- **PDF/A**: la variante de PDF para archivo a largo plazo, que algunos
  organismos exigen.

**Para decidir al llegar**

- **Qué significa «no recuperable» en un `.docx`.** Hoy la garantía es que el
  export es 100 % imagen (ADR-009). Un Word editable lleva texto, y además
  historial de cambios, comentarios, metadatos y objetos embebidos. Necesita
  su propia definición y su propio gate.
- El texto preservado tiene el mismo problema que el `.docx`: hay que
  garantizar que lo sensible se eliminó y no solo se tapó. Estaba «en
  investigación» en `Future_Ideas.md` §7, con un prototipo pendiente.
- PDF/A: si `pdf-lib` alcanza o hace falta otra librería (R-12).
- Cómo se muestra un Word en el visor, que hoy dibuja páginas de PDF.
- Qué se hace con las imágenes escaneadas dentro de un Word.
- Si cada formato de entrada puede salir en cualquier formato, o solo en el
  suyo y en PDF.
- Excel no tiene páginas: la interfaz necesita otra forma de mostrarlo.
- Un motor por formato, cada uno con su spec y su ADR (R-12 para las
  dependencias nuevas).
- Orden interno sugerido por el planificador, sin decidir: Word, imágenes
  sueltas (es el caso más barato: OCR directo), y después Excel y
  PowerPoint.

## 7. 1.4 — Trabajo con IA

Pensado para quien usa el documento anonimizado con un asistente de IA y
después necesita volver a los nombres reales.

### 7.1 Export a `.md`

Solo el texto, con los reemplazos aplicados. Para que la IA no tenga que leer
una imagen escaneada.

**Para decidir al llegar**

- Rompe «el export es 100 % imagen» (ADR-009; ADR-059 §4 eligió rasterizar
  hasta la hoja de referencia para sostenerlo). Lleva ADR.
- Lo que la detección no encontró sale como texto en claro, legible por
  máquina. Hoy también es legible con OCR, pero acá no hace falta ni eso.
- Qué sale en los modos `redact` y `mask`.
- El texto de un escaneo sale con la calidad del OCR, y el orden de lectura
  de una página con columnas puede no ser el esperado (ADR-110, ADR-113).

### 7.2 Glosario para des-anonimizar

Un glosario por documento que guarda qué valor real corresponde a cada
marcador. Un apartado nuevo de la aplicación recibe un texto con marcadores,
el usuario indica de qué documento se trata, y devuelve el texto con los
valores reales.

Ejemplo: en una pericia, «Juan Pérez» se anonimiza como `[PERSONA 01]`. El
usuario trabaja con IA sobre el documento anonimizado y obtiene «Por tal
motivo, [PERSONA 01] deberá presentarse ante la justicia…». Pega ese texto,
elige el documento, y recibe «Por tal motivo, Juan Pérez deberá presentarse
ante la justicia…».

**Decidido por el humano (2026-10-02)**

- Es **100 % opcional y viene desactivado**.
- Para activarlo, el usuario elige **en qué carpeta** se guardan los
  glosarios.
- Se guardan **siempre cifrados**. Nunca en claro.
- La contraseña es **una sola, a nivel de la aplicación**, no una por
  documento.
- Si el usuario olvida la contraseña, puede restablecerla, pero **solo
  borrando todos los glosarios guardados**: no hay forma de comprobar que es
  el usuario real.

**Para decidir al llegar**

- Es el cambio más grande al modelo de seguridad: hoy la aplicación no guarda
  en disco nada del documento (`08_Security_Model.md`), y el glosario guarda
  justamente los valores originales. Ese documento se reescribe en la parte
  que corresponda, con su ADR.
- El Core no accede al sistema de archivos (R-10). El glosario vive fuera del
  Core.
- La hoja de referencia de marcadores (ADR-059) tiene la regla contraria a
  propósito: marcador → tipo, nunca valores originales. El glosario no viaja
  en el export.
- Solo los marcadores (`[PERSONA 01]`) se revierten sin ambigüedad. `mask` y
  `redact` no se pueden revertir. Un valor sintético se puede confundir con
  texto real.
- La IA puede devolver el marcador alterado: `[PERSONA 1]` en lugar de
  `[PERSONA 01]`, sin corchetes, o en su forma abreviada (`[PERS 01]`,
  ADR-057). Hay que decidir cuánto se tolera.
- Cómo se identifica cada documento en la lista, dado que su nombre también
  puede ser un dato sensible.
- Qué pasa con los glosarios si el usuario cambia de carpeta, y con las
  copias que haya hecho fuera de ella: el restablecimiento no las puede
  borrar, aunque quedan cifradas con la contraseña anterior.
- Cómo se deriva la clave a partir de la contraseña, y qué se guarda para
  comprobarla.

## 8. Decisiones del 2026-10-02 sobre los roadmaps anteriores

- Filtros y búsqueda con regex en el árbol: 1.1 (§4).
- Recall y precisión de NER como gate: 1.2 (§5).
- Export con texto preservado y PDF/A: 1.3 (§6).
- «Validar muestra»: 1.0.x (§3), junto con el gate de ADR-148.
- Plantillas de reglas: idea sin versión (`Future_Ideas.md` §4.2).
- Reporte de anonimización: se considera cubierto por la hoja de referencia
  de marcadores del diálogo de exportar (ADR-059). Esa hoja lista marcador y
  tipo, sin cantidades ni modos.
- Registro de auditoría: descartado (§11).
- Reprocesar las páginas de un grupo editado: pendiente sin ubicar (§9).

## 9. Pendientes sin ubicar

Hallazgos técnicos conocidos, y un ítem de producto, que no tienen versión
asignada.

- Reprocesar las páginas de un grupo editado: después de editar una entidad,
  volver a correr el modelo de nombres solo en las páginas donde aparece,
  para encontrar apariciones que la primera pasada no vio.

- Patrón para el número de expediente judicial
  (`Post_Hito10.8_Pendientes.md` §26).
- PDF con rotación de página declarada (`/Rotate ≠ 0`), sin medir (§8).
- Censura sobre texto superpuesto, como un sello que pisa el cuerpo (§7).
- Variantes de operaciones de imagen de pdf.js sin cubrir (§9).
- Dos nombres en un mismo renglón separados por mucho espacio, como una
  línea de firmas, se detectan como una sola persona. Visto el 2026-10-02 al
  armar las capturas del README, con un documento ficticio; sin diagnosticar.
- Cobertura de tests del contenedor Electron, que pide su ADR (`MVP.md`,
  Hito 11.5).
- Navegación por teclado del árbol de entidades y auditoría de accesibilidad
  (§22).
- Bajar los techos de memoria para equipos de menos de 8 GB (ADR-192).
- Búsqueda difusa al agregar una entidad a mano (`Future_Ideas.md` §5.1b) y
  un control para restaurar el reemplazo automático (§5.6).

## 10. Menciones

- **Interfaz en inglés.** Último paso: el público objetivo es argentino, o al
  menos hispanohablante. El selector de idioma está oculto hasta entonces.

## 11. Fuera de la línea 1.x

- **2.0**: `Version_2.0.md`.
- **Ideas sin fecha**: `Future_Ideas.md`.
- **Descartado**: export a PNG y marca de agua (`Version_1.0.md` §5), y el
  registro de auditoría (`Future_Ideas.md` §3.2).
