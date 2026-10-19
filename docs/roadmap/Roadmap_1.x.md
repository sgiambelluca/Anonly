<!-- CONTEXT: scope=roadmap-1.x | dependencias=roadmap/Plan_1.1.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,adr/ADR-224-Lo-Que-La-1.1-Cambia-En-El-Panel-De-Entidades-Y-El-Visor.md,roadmap/Version_1.0.md,roadmap/Version_2.0.md,roadmap/Future_Ideas.md,roadmap/hitos/Post_Hito10.8_Pendientes.md,RELEASING.md,00_Project_Vision.md,architecture/08_Security_Model.md,adr/ADR-009-Export-Strategy.md,adr/ADR-059-Leyenda-Opcional-De-Marcadores.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,roadmap/hardening/Export_Verificado_ADR148_Plan.md,roadmap/hardening/ADR148_Revision_2026-10-05.md,roadmap/hardening/ADR148_Revision_Sol61_2026-10-05.md,roadmap/ocr/Regiones_Pequenas_Investigacion_Plan.md,adr/ADR-202-El-Minimo-De-Region-OCR-Se-Prueba-A-25pt-Antes-De-Adoptarlo.md,roadmap/ocr/Regiones_Pequenas_25pt_Experimento_Plan.md,roadmap/interaccion/Mejoras_Interaccion_2026-10-05.md,adr/ADR-204-La-Interaccion-Anonimizada-Usa-La-Geometria-Visible.md,adr/ADR-205-El-Resultado-Exportado-Pertenece-A-Una-Revision.md,adr/ADR-206-Una-Busqueda-Omitida-No-Confirma-La-Version.md,roadmap/interaccion/Revision_ADR204_2026-10-07.md,roadmap/hardening/Confianza_1.0.x_Plan.md,roadmap/hardening/Confianza_Cierre_2026-10-08.md,adr/ADR-217-Una-Direccion-Con-Palabra-Clave-Es-Un-Patron.md,roadmap/mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md,adr/ADR-210-El-Repintado-De-Linea-Desplaza-Los-Pixeles-Del-Renglon.md,adr/ADR-211-El-Email-Tolera-La-Arroba-Leida-Como-Q-En-Texto-De-OCR.md,adr/ADR-212-La-Direccion-Incluye-La-Altura-Que-La-Sigue.md,adr/ADR-213-Cambiar-De-Vista-No-Muestra-Una-Imagen-A-Otra-Escala.md,adr/ADR-214-La-Que-Pierde-Un-Conflicto-No-Se-Descarta-Si-Cubre-Mas-Texto.md,roadmap/mediciones/ocr/Emails_DPI_Nativo_2026-10-07.md,roadmap/mediciones/ner/Altura_De_Direcciones_2026-10-07.md,roadmap/distribucion/SignPath_Postulacion.md,architecture/08_Security_Model.md | audiencia=humanos+IA | fase=12 -->

# Anonly — Roadmap 1.x

> Qué sigue después de la 1.0, en qué orden y con qué criterio se numera.
> Decidido por el humano el 2026-10-02. Es el documento que manda para
> planificar; `MVP.md` queda como registro histórico.

Cada versión de este roadmap arranca igual que un hito: el planificador
audita, escribe los ADR y los specs, y recién después se implementa. **Las
secciones «Para decidir al llegar» listan lo que ya se sabe que hay que
resolver; no son decisiones tomadas.**

## 1. Cómo se numera

La campaña local de [mejoras de interacción](./interaccion/Mejoras_Interaccion_2026-10-05.md)
está implementada desde develop con ADR-204/205 y aprobada por Sol contra
`origin/develop` (2026-10-06). Sus pruebas y revisión se registran en ese plan;
la rama está publicada en el [PR #53](https://github.com/sgiambelluca/Anonly/pull/53)
hacia develop, sin release ni versión asignada.
Los tres ajustes reportados después de esa aprobación también están
implementados y aprobados por Sol; el cierre está en el mismo plan (ADR-206).

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

## 2ter. 1.0.2 — Avisos y novedades

Tres cambios de interfaz pedidos y aprobados por el humano el 2026-10-08
sobre un lienzo de diseño. **El humano decidió ese día que salen en la
1.0.2.** «Novedades» es una capacidad nueva que el usuario ve, y por §1
correspondería a una versión menor: va en este parche por esa decisión.

- **El aviso de espacio justo muestra el resultado de cada salida** y aplica
  la que el usuario elige (ADR-215 §1).
- **«Eliminar entidad» confirma con un diálogo propio**, que muestra el dato
  a la vista y dice que se puede deshacer (ADR-215 §2).
- **La versión del pie de inicio abre «Novedades»**: lo que trae cada versión
  publicada, escrito para el usuario y compilado con la aplicación, sin
  conexión (ADR-216). Suma un paso al release: escribir la entrada de la
  versión (`RELEASING.md`).

Plan: [`Avisos_Y_Novedades_2026-10-08.md`](interaccion/Avisos_Y_Novedades_2026-10-08.md).

## 3. 1.0.x — Confianza

Lo primero, porque es lo que permite tocar la detección sin miedo.

**Asignación del 2026-10-12:** el mantenedor solicita promover develop a
main para preparar **1.0.2**, con Confianza y Avisos/novedades juntos.
El [plan de preparación](hardening/Release_1.0.2_Preparacion_2026-10-12.md)
distingue el PR solicitado de los requisitos restantes antes del tag.
El número reemplaza la falta de asignación del registro histórico siguiente.

**Decisión vigente del mantenedor (2026-10-10):** cerrar el bloque con RC
y dejar la mejora de orientación SV/CP como **PENDIENTE DE DESARROLLO**,
para retomarla cuando disponga de más PDF escaneados y pueda hacer mayores
pruebas. Será el único punto abierto de 1.0.x al completar el resto del
cierre. [Riesgo, evidencia y condiciones de retoma](ocr/Orientacion_SV_CP_Retoma_2026-10-10.md).

> **Orden decidido por el humano el 2026-10-07.** La próxima branch de trabajo
> toma cuatro puntos de esta lista: el repintado de línea, los emails en
> escaneos de baja resolución, las direcciones, y la medición de memoria del
> perfil Bajo. Cada uno arranca como cualquier hito: auditoría, ADR y spec
> antes que código. Siguen abiertas, y se deciden al empezar cada punto, las
> preguntas de sus apartados «Para decidir al llegar». «Validar muestra» y la
> página escasa y girada quedan para después.
>
> Plan de la branch: [`Confianza_1.0.x_Plan.md`](hardening/Confianza_1.0.x_Plan.md).
> El mismo día el mantenedor decidió que el repintado no se apaga y se corrige
> (ADR-210, que aceptó ese día), y que en emails primero se mide una línea de
> base.

> **Cierre del bloque, decidido por el humano el 2026-10-08.** Los puntos que
> quedan abiertos se cierran en una branch propia, y todo sale junto en una
> sola versión: no se publica antes lo que ya está en `develop`. Quedaban
> abiertos «Validar muestra», la página escasa y girada y la repetición de
> M2. Se suma un patrón de direcciones por palabra clave. El número de esa
> versión no está decidido: «Validar muestra» es una capacidad que el usuario
> ve (§1).
>
> Plan de la branch: [`Confianza_Cierre_2026-10-08.md`](hardening/Confianza_Cierre_2026-10-08.md).

> **Retoma en Codex, 2026-10-10.** M-O3 terminó con 30/30 corridas válidas,
> provisionales. El peor caso aumenta el tiempo 3,4–4,4 veces y la memoria
> fría del ensayo con ruido 444,6 MB; esos números describen el peor caso
> forzado. La decisión posterior acepta RC y difiere SV/CP sin umbral.
> «Validar muestra» tiene propuesta de interacción e instrumento
> M-V1 integrado: la primera campaña se interrumpió por preparación de
> conflictos y quedó preservada. RC aislado terminó 12/12 válido, provisional: cerca de un
> segundo adicional en el escaneo real de veinte páginas y unos veinte con
> diez hojas de ruido. RC fue aceptado el 2026-10-10; SV/CP quedó diferido
> hasta disponer de más documentos/escaneos, como único pendiente diferido
> de esta actualización ([evidencia y retoma](ocr/Orientacion_SV_CP_Retoma_2026-10-10.md)).
> El costo implementado quedó confirmado en doce corridas nuevas: alrededor
> de un segundo en R1 y diecinueve con diez hojas de ruido. M-O1 sobre RC
> terminó 700/700 sin cambios inesperados en la proyección registrada.
> M-V1 terminó sus 36 celdas en carpeta nueva con esa identidad: 30 flujos
> exitosos y seis lecturas parciales de R4, sin errores de instrumento ni
> invalidaciones. R4 llega Ready con páginas OCR fallidas y picos 4,17–4,36 GB;
> no se presenta como validación satisfactoria. Ver [informe](mediciones/transversal/Validar_Muestra_Costo_Lectura_2026-10-10.md).
> El arnés
> corregido pasó un smoke de tres documentos, incluido R1. La función todavía
> no se implementó; la propuesta fue retirada el 2026-10-11. La revisión del lote
> permanece al final.

> **Decisión del 2026-10-11:** «Validar muestra» se retira del roadmap y del
> alcance de Confianza. El mantenedor prioriza la revisión manual del documento
> y la configuración de sus entidades; no se desarrolla la verificación
> automática post-export. Reemplaza las decisiones anteriores de incluirla y
> ofrecer un botón. Diseño, mediciones y diagnóstico quedan como antecedentes
> históricos, sin decisiones de UX/comparación/costo pendientes.

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
  R-16 verde y Sol 6.1 APPROVED.** **Cierre remoto: 21/21 macOS y CI completa
  success** en [run 37383499951](https://github.com/sgiambelluca/Anonly/actions/runs/37383499951)
  sobre HEAD `93f0d3a`;
  el humano autorizó commit y push utilizando develop. Los cambios están en
  [PR #52 hacia develop](https://github.com/sgiambelluca/Anonly/pull/52), pues
  la protección exige PR. La primera espera por el incidente de runners
  quedó superada por el relanzamiento verde. **Integrado:** el PR #52 entró a
  `develop` el 2026-10-05 y el PR #58 lo promovió a `main` el 2026-10-07. Ver
  [evidencia y revisión final](hardening/ADR148_Cierre_ADR203_2026-10-05.md).
  La ampliación del gate de export terminó 23/23 localmente, sin fallos,
  salteados o flaky; la revisión del lote sigue pendiente
  ([evidencia](hardening/Export_Gate_Ampliacion_2026-10-10.md)).
- **Emails en escaneos de baja resolución**: causa encontrada el 2026-10-07.
  Es la lectura del OCR, no el patrón: de los 11 emails perdidos en la
  campaña de DPI descendente, en 9 la `@` se leyó como `Q` y en 2 el punto
  del nombre se leyó como espacio
  ([informe](mediciones/ocr/DPI_Descendente_Fase1_Windows_2026-10-01.md) §2.1).
  A 300 dpi no pasa. **Línea de base medida el 2026-10-07** sobre sintéticos
  de 200 y 150 dpi nativos: a 200 no se pierde ninguno, y a 150 se pierden 2
  de 25, con letra de 8 pt y por la misma `Q`
  ([informe](mediciones/ocr/Emails_DPI_Nativo_2026-10-07.md)). Los sintéticos
  son limpios; un escaneo real puede leerse peor.

  **Decidido el 2026-10-07**: se cubre la `@` leída como `Q`, y solo ese
  caso (ADR-211). La línea de base sobre
  textos con degradación de fotocopia se midió ese día: sin pérdidas a 300 y
  a 200 dpi nativos; a 150, 4 de 10, y en tres de ellas la `Q` viene con un
  espacio después del punto del nombre. Con ese dato el mantenedor aceptó
  ADR-211 incluyendo el espacio, a condición de medir el avance antes y
  después. **Implementado y medido ese día**: los emails perdidos pasaron de
  11 a 2 al forzar la resolución y a cero a resolución nativa, sin ningún
  email agregado ni otra entidad distinta. Los 2 que quedan son el punto
  leído como espacio sin `Q`, que solo aparece al forzar la lectura a 150
  dpi. Revisado. Lo que sigue es cómo estaba planteada la pregunta.

  **Para decidir al llegar**: si la detección tolera esa lectura (reconocer
  `nombre.apellidoQdominio.tld` como email cuando el texto viene del OCR, y
  extender hacia atrás un email cuyo nombre quedó partido por un espacio), con
  qué límite para no inventar emails. En la línea de base, ninguna otra
  cadena del texto tiene esa forma. Es un cambio de detección: lleva ADR y spec de Regex antes
  que código, y sale como parche.
- **Página escasa y girada** (riesgo aceptado de ADR-190): recalibrar el
  criterio de lectura fiable o verificar ángulos en páginas escasas.
  **Tomado el 2026-10-08**: primero una medición que busque el caso y que
  diga cuánto cuesta verificar ángulos; con esos números se decide
  ([plan](hardening/Confianza_Cierre_2026-10-08.md), frente 3).

  **Medido el 2026-10-09 (M-O1)**: no apareció ningún veredicto equivocado
  (48 de 48 correctos sobre 128 PDF; en las páginas escasas el OSD no afirma
  nada). Si lo hubiera, el producto no avisa: 194 de 384 casos forzados
  salen sin los datos y sin aviso. La medición encontró además un hueco real
  sin forzar nada: una página con un solo renglón, escaneada de costado,
  sale sin leer y sin aviso (4 de 4). La decisión inicial se tomó después
  ([informe](mediciones/ocr/Veredicto_De_Orientacion_Equivocado_2026-10-09.md)).

  **Decidido e implementado el 2026-10-10:** RC amplía la recuperación
  de páginas sin veredicto, primera lectura vacía y tinta mayor que cero.
  Los cuatro N1 se recuperan y quedan tapados en el export real; pruebas
  OCR, seis regresiones, calidad normativa y costo adoptado pasaron.
  Caracterización M-O1 completa 700/700, con ocho cambios previstos y
  ninguno inesperado; revisión del lote pendiente.
  SV/CP queda **pendiente de desarrollo**, cerrado momentáneamente como
  trabajo diferido hasta disponer de más PDF escaneados, con el riesgo
  residual documentado. Es el único pendiente que se conserva para
  después del cierre de 1.0.x; no se adopta el umbral 0,8.
- **Direcciones**: 0 de 4 en la línea de base de calidad. **Auditado el
  2026-10-07**: en los cuatro casos el modelo detecta la calle y deja afuera
  el número («Maipú» en lugar de «Maipú 1434»), así que la altura queda a la
  vista. El camino propuesto es extender la dirección que el modelo ya marca
  ([plan](hardening/Confianza_1.0.x_Plan.md), frente 4).

  **Decidido el 2026-10-07 (ADR-212, a prueba)**: solo la altura, con una
  regla de contexto para no tapar años: un número con forma de año se suma
  solo si hay una palabra de dirección cerca. Si la medición muestra que deja
  escapar alturas, se pasa a tapar siempre.

  **Implementado y medido el 2026-10-07**
  ([informe](mediciones/ner/Altura_De_Direcciones_2026-10-07.md)): las
  cuatro direcciones de la línea de base quedan cubiertas, sin otro cambio.
  Sobre 76 oraciones sintéticas, la regla deja a la vista 6 alturas con
  forma de año y tapa 4 años de más; tapar siempre deja 0 y tapa 9.
  **Decidido ese día: tapar siempre.** El número que sigue a una dirección
  se suma aunque tenga forma de año. Aparte, en 9 de 48 oraciones
  con un domicilio el modelo no marcó la calle: ese límite no lo cierra
  ninguna de las dos.

  **Un defecto que apareció al revisar, y ya estaba en la 1.0**: en texto en
  mayúsculas, una dirección que chocaba con el patrón de patente («AVENIDA
  DEL MAR 450») se descartaba entera y la calle quedaba a la vista.
  Corregido en la misma branch con ADR-214: una detección que pierde un
  conflicto ya no se descarta si cubre texto que la ganadora no cubre. La
  línea de base de calidad quedó en 78 de 78.

  **Decidido el 2026-10-08, sobre las calles que el modelo no marca**: entra
  un patrón anclado en una palabra clave («Av.», «calle», «domicilio en»),
  que valga igual en mayúsculas y en minúsculas. Primero se mide la línea de
  base; después, ADR y spec de Regex. Una calle sin palabra clave antes («se
  presentó en Urquiza 98») queda como limitación conocida
  ([plan](hardening/Confianza_Cierre_2026-10-08.md), frente 2).

  **Línea de base medida el 2026-10-08**
  ([informe](mediciones/ner/Direcciones_Con_Palabra_Clave_2026-10-08.md)):
  con una palabra clave antes de la calle, queda algo a la vista en 41 de
  138 páginas sintéticas, 8 en escritura normal y 33 en mayúsculas. El
  mantenedor decidió ese día una sola regla para las tres escrituras,
  aceptando lo que tapa de más en un texto todo en mayúsculas. ADR-217,
  aceptado ese día.

  **Implementado y medido el 2026-10-09** (provisional: el patrón estaba sin
  commitear al medir): quedan 4 de 138 a la vista, ninguna trampa tapada en
  escritura normal y 12 de 18 en mayúsculas, que es lo que se esperaba. Falta
  el revisor y repetir la medición sobre el commit.
- **Firma de Windows con SignPath: cerrado sin firma.** SignPath rechazó la
  postulación (informado el 2026-10-07). No hay otra vía gratuita, así que
  Windows sigue sin Authenticode y pasa a figurar como riesgo aceptado en
  `08_Security_Model.md` §2.3. Qué cambia y qué no:
  [`SignPath_Postulacion.md`](distribucion/SignPath_Postulacion.md) §6. No
  condiciona ninguna versión.
- **El repintado de línea dibuja con otra tipografía y depende del zoom**
  (hallazgo del 2026-10-07). **Corregido en la branch de Confianza**: ADR-210,
  aceptado ese día, mueve los píxeles del renglón y elimina la calibración.
  Implementado, probado en la app y revisado. De la revisión salió una
  guarda: si la franja que se mueve cruza la caja de otro dato tapado, no se
  repinta. Lo que sigue es el planteo original. Al revisar la interacción en la
  vista anonimizada (ADR-204, que quedó validada) se midió que el repintado
  de ADR-058 redibuja el resto del renglón en monoespaciada chica, y que se
  activa o no según la escala: el mismo renglón cambia con el zoom, y nada
  garantiza que el export coincida con el preview. No es una fuga de dato.
  Medición y hallazgos H-1 a H-4:
  [`Revision_ADR204_2026-10-07.md`](interaccion/Revision_ADR204_2026-10-07.md).

  **Para decidir al llegar**: si el repintado se corrige (calibrar al tamaño
  real del renglón, con su gate visual y un test con tipografías reales) o se
  apaga hasta corregirlo, que deja siempre el encogido de ADR-058 §1. Las dos
  cambian el PDF exportado: por el criterio de §1 es un parche, y las notas de
  la versión lo dicen.
- **Memoria**: el perfil Bajo se midió el 2026-10-07: 2,05 GB de máximo en
  Windows. El mantenedor fijó su techo en **2,5 GB** ese día, en lugar del
  provisorio de 3,5 GB (ADR-194 §7;
  [plan](hardening/Confianza_1.0.x_Plan.md), M-M1). **Cerrado.**

  **M2 repetido el 2026-10-08**: P1 dio 1619,0 MB de máximo y P2 2813,1 MB,
  los dos debajo de sus techos de 2,0 y 3,0 GB (ADR-192, «Medición del
  2026-10-08»). El margen de P2 sigue siendo menor que el ruido: eso no lo
  cambia otra medición.

## 4. 1.1 — Detección a medida del usuario

**Definición funcional cerrada el 2026-10-19**, en dos sesiones con el
mantenedor (2026-10-13 y 2026-10-19). ADR-219 a ADR-224 están aceptados
desde el 2026-10-19, y los contratos y los specs de motor ya están
escritos. El diseño de la interfaz lo hace el mantenedor más adelante. Todo el
detalle está en [`Plan_1.1.md`](./Plan_1.1.md).

- **Generador de formatos**, en lugar de patrones regex. El usuario no
  escribe una regex: arma el formato con piezas (ADR-220). Un formato
  propio puede ir bajo un tipo propio o bajo un tipo base que depende del
  país. Los formatos base de pura forma se editan; los que tienen control
  solo se prenden y apagan. Se abre solo desde la pantalla de inicio.
- **Catálogos por país**: el mecanismo y Argentina. Un país activo, con
  sus etiquetas y sus sintéticos (ADR-221). Chile y Uruguay salen en la
  1.1.1 (§4bis).
- **Tipos de entidad propios**, con nombre e identidad propios. Sus modos
  son etiqueta, máscara y censura total, sin sintético. Los creados desde
  inicio se guardan; los creados con un documento abierto son de ese
  documento (ADR-219).
- **«Nuevo tipo» con el documento abierto.** Si una entidad no entra en
  ninguna categoría, el usuario crea una aparte, le pone nombre y la manda
  ahí, al agregarla, al cambiarle el tipo o desde el panel de conflicto. Es
  un tipo auxiliar: se pierde al cerrar el documento y no se guarda para
  el próximo análisis. Reemplaza a «Custom», que deja de ofrecerse
  (ADR-219 §5, ADR-224 §6).
- **Dos formatos que se pisan van al panel de conflicto** cuando uno es
  propio (ADR-222).
- **Exportar e importar formatos**, para que un usuario experto arme
  formatos y otros los usen (ADR-223).
- **Filtros en el panel de entidades**: por formato, por modo, desactivadas
  o con conflicto, y agregadas o editadas a mano (ADR-224).
- **Panel de ayuda de atajos de teclado**, con los atajos que ya existen.
- **Tooltips enriquecidos en el visor**: valor original, tipo, modo,
  cantidad de apariciones y formato.

**Decidido el 2026-10-19:** la **búsqueda con regex** en el árbol sale de la
1.1 y del roadmap. La lupa y el buscador del panel no cambian (ADR-224 §1).

**Lo que quedó resuelto de «Para decidir al llegar»**

- Formatos base por país: un catálogo activo; Argentina en la 1.1, y Chile
  y Uruguay en la 1.1.1 (ADR-221). El contenido de Chile y Uruguay se
  investiga y se mide antes de escribirse (ADR-221 §6).
- Dónde se guardan los formatos y si se exportan: en el equipo, en claro, y
  se exportan e importan (ADR-223).
- Cómo expresa un formato el generador y qué se configura de los
  existentes (ADR-220).
- Duplicados: un formato idéntico no se crea; uno que comparte textos avisa
  y deja crear (ADR-220 §3).
- Un patrón que cuelga el análisis: el generador se recorre en tiempo
  lineal, y por construcción no puede colgarlo. Si un formato falla, el
  análisis sigue y avisa (ADR-220 §2 y §6).
- La guarda de corrida de ADR-075 §2 se aplica a los formatos propios, sin
  excepción (ADR-220 §2).
- Modos, agrupación y ciclo de vida de un tipo propio (ADR-219). La
  pregunta de síntesis de `Future_Ideas.md` §5.5 queda fuera de la 1.1.

## 4bis. 1.1.1 — Chile y Uruguay

**Decidido por el mantenedor el 2026-10-19.** La 1.1 sale con Argentina
sola, y los catálogos de Chile y Uruguay salen en la 1.1.1. Traen sus
formatos, los nombres de sus tipos (por ejemplo, RUT) y sus generadores
sintéticos. Con ellos aparecen el selector de país y «agregar desde otro
país», que en la 1.1 quedan ocultos (ADR-221 §7).

Por §1 correspondería a una versión menor. Va en un parche por esa
decisión, como «Novedades» en la 1.0.2 (§2ter).

**Para decidir al llegar**

- Las tablas de cada país: formatos, tipo de cada uno, nombres, controles,
  máscaras y generadores. El mantenedor las aprueba con su medición antes
  de escribirlas en los specs (ADR-221 §6).
- No hay documentos reales de Chile ni de Uruguay: el informe dice qué sale
  solo de sintéticos.

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

- Filtros en el árbol: 1.1 (§4). La búsqueda con regex se retiró el
  2026-10-19 (ADR-224 §1).
- Recall y precisión de NER como gate: 1.2 (§5).
- Export con texto preservado y PDF/A: 1.3 (§6).
- «Validar muestra»: se ubicó en 1.0.x el 2026-10-02; **retirada del roadmap
  el 2026-10-11**, sin desarrollo previsto.
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
- ~~El visor no vuelve a pedir la imagen al cambiar entre Original y
  Anonimizado después de un zoom~~: la otra vista quedaba con su imagen
  anterior estirada hasta el próximo zoom o scroll. Visto el 2026-10-07 al
  escribir el E2E del repintado. **El mantenedor pidió arreglarlo en la branch
  de Confianza** ese mismo día, y también el mismo efecto al editar una
  entidad. Arreglado en el cliente (`hardening/Confianza_1.0.x_Plan.md`,
  frente 5). El instante borroso de menos de un cuarto de segundo que
  quedaba al conmutar se elimina con ADR-213, aceptado ese día.
- En un escaneo quedan restos tenues, no legibles, de la tinta original
  alrededor de una etiqueta que entra en su caja. Visto el 2026-10-07 en una
  captura del export; sin medir contra el gate de ADR-148.
- Al pasar a «Anonimizado» se ve un cuadro gris de unos 16 ms aunque haya
  una imagen guardada. Evitarlo pide tener las imágenes ya decodificadas
  (2026-10-07, `hardening/Confianza_1.0.x_Plan.md`, frente 5).
- El reintento del visor, cada 700 ms, reinicia un dibujo que tarda más que
  eso. Visto solo con un atraso artificial de 1,5 s; falta medir cuánto tarda
  un dibujo real en un equipo lento.
- Dos direcciones de la misma calle con alturas parecidas quedan en un mismo
  grupo, por la agrupación difusa (visto el 2026-10-07 con «AVENIDA DEL MAR
  4500» y «AVENIDA DEL MAR 450»).
- El test `interaction geometry does not change full rendering` compara el
  lienzo de codificación y no el de la página.
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
