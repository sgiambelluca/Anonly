<!-- CONTEXT: scope=roadmap-1.2 | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Spike_ZetaOffice_2026-11-23.md,roadmap/formatos/Investigacion_Librerias_2026-11-23.md,architecture/08_Security_Model.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md | audiencia=humanos+IA | fase=1.2 -->

# Opciones para convertir Word, Excel y PowerPoint

> Comparación que pidió el mantenedor el 2026-11-23 para decidir el
> conversor de la 1.2 (`Plan_1.2.md` §7). Lo medido sale del spike
> ([`Spike_ZetaOffice_2026-11-23.md`](./Spike_ZetaOffice_2026-11-23.md)), con
> corpus sintético. Lo demás sale de la investigación
> ([`Investigacion_Librerias_2026-11-23.md`](./Investigacion_Librerias_2026-11-23.md))
> o es una estimación, y lo dice.

## Qué cuesta igual con cualquier opción

- **El Word limpio** se arma desde el XML del `.docx`, no desde el
  conversor (`Plan_1.2.md` §6.2 y §6.3). Su trabajo no cambia con la
  opción.
- **El descifrado de un Office con contraseña** se hace en JS: el Word
  limpio necesita el `.docx` en claro de todos modos.
- **El reconocimiento del formato por contenido** (ADR-238 §2) va antes del
  conversor.
- **El tamaño del instalador** no cuenta: el mantenedor lo aceptó el
  2026-11-23.

## Resumen

| | 1. ZetaOffice en una ventana aparte | 2. LibreOffice WASM compilado por nosotros | 3. LibreOffice de escritorio | 4. Renderizadores en JavaScript |
|---|---|---|---|---|
| Fidelidad | Alta (motor de LibreOffice), medida en sintéticos | Alta, la misma | Alta, la misma | Baja en Word, sin opción seria en Excel, dudosa en PowerPoint |
| El documento queda solo en RAM | Sí, medido | Sí | **No**: archivos temporales en disco | Sí |
| Excepción de seguridad | **`unsafe-eval`**, solo en esa ventana | Ninguna: corre en un Worker con la CSP de la app (medido, spike de LOWA) | Ninguna en Chromium; suma un proceso nativo | Ninguna |
| Memoria extra al convertir | ~1,2 GB, medido, antes del pico del análisis | ~0,75 GB, y vuelve a cero al terminar el Worker (medido) | Unos cientos de MB, estimado | Poca |
| Espera por documento | ~2,6 s de arranque + 0,05–0,6 s, medido | ~2,9 s de arranque + 0,04–0,8 s, medido | Unos segundos de arranque, estimado | Poca |
| Esfuerzo para empezar | Bajo: el binario ya existe | Bajo: ya compiló, en 75 a 85 min y sin tocar código (medido) | Medio: empaquetar por sistema y controlar un proceso | **Alto**: mucho código propio, sobre todo Excel |
| Mantenimiento | Depende de las versiones de allotropia (la última es de 2025-05) | Nuestro: recompilar con cada versión de LibreOffice | Bajo: LibreOffice publica seguido | Alto |
| Contraseña de Office | JS propio | Podría hacerla el conversor (con NSS) | La hace el conversor | JS propio |

## 1. ZetaOffice en una ventana oculta aparte

LibreOffice ya compilado a WASM por allotropia, que corre en una ventana de
Electron que se abre para convertir y se cierra al terminar.

**A favor**
- Fidelidad de LibreOffice. En el corpus llegó al PDF todo el texto
  visible, con los tamaños de página, las secciones apaisadas y el área de
  impresión de Excel.
- Rápido una vez arrancado: entre 0,05 y 0,6 s por documento.
- Sin red, y sin dejar contenido del documento en disco: lo midió el
  spike.
- Se puede empezar ya: el binario existe y el spike lo hizo andar.
- Se puede reemplazar más adelante por la opción 2 sin cambiar nada más,
  porque las dos son el mismo LibreOffice WASM con la misma API.

**En contra**
- **Necesita `unsafe-eval`**: permite ejecutar código armado en el
  momento, que la app hoy bloquea. Queda solo en esa ventana, sin red, sin
  acceso al resto de la app y con su propia sesión, pero es una excepción a
  la regla de seguridad, y lleva un ADR que enmienda `08_Security_Model.md`.
- **~1,2 GB más de memoria mientras convierte.** No se suma al pico de hoy,
  porque la ventana se cierra antes de que empiecen el OCR y la detección.
  Durante la conversión, la app ronda los 2 GB (falta medirlo en la app
  real).
- **~2,6 s de espera por documento**, porque la ventana se crea de cero
  cada vez para devolver la memoria.
- No descifra un Office con contraseña: el descifrado va en JS.
- Las actualizaciones de LibreOffice dependen de allotropia.
- Calibri, Arial, Times y Cambria se reemplazan por fuentes de la misma
  medida. Otras, como Verdana o Tahoma, no: ahí los saltos de línea y de
  página pueden diferir de Office.
- Una vez apareció un error de memoria del WASM, sin causa confirmada.

## 2. LibreOffice WASM compilado por nosotros

El mismo LibreOffice, compilado desde su código fuente con la receta
oficial ("LOWA"), con opciones que el binario de allotropia no trae: sin
interfaz gráfica y sin código dinámico.

**Lo que midió el spike** (2026-11-23,
[`Spike_LOWA_2026-11-23.md`](./Spike_LOWA_2026-11-23.md), con corpus
sintético):
- **Compiló a la primera**, en 75 a 85 minutos en esta máquina.
- **Corre en un Worker con la CSP de la app**, sin `unsafe-eval`.
- **Gasta menos memoria que la 1**, y la devuelve entera al terminar el
  Worker.
- **Las mismas páginas que la 1.** El PDF sale etiquetado y mucho más
  pesado, salvo con `UseTaggedPDF=false`. Las fuentes de reemplazo cambian.

Los «sin confirmar» de la lista de abajo quedaron respondidos en el spike.

**A favor**
- Misma fidelidad que la 1.
- **Podría no necesitar `unsafe-eval`** y correr dentro de un Worker, como
  el resto del Core, sin ventana aparte. No está confirmado.
- Elegimos la versión de LibreOffice, con sus arreglos de seguridad, y
  podemos sumar NSS para descifrar, o sacar lo que no se usa (interfaz,
  fuentes) para que pese y gaste menos.
- La licencia queda clara: compilamos desde el código abierto.

**En contra**
- **No sabemos si sale.** Hay que probarlo antes, y es una prueba de días:
  la compilación de LibreOffice tarda horas y ocupa decenas de GB.
- Compilarlo sin código dinámico puede hacerlo más lento. Sin medir.
- Cada versión nueva de LibreOffice nos obliga a recompilar. Puede no
  entrar en los límites de los runners gratuitos de CI, y entonces se
  compila en esta máquina.
- Mientras tanto, Word, Excel y PowerPoint no avanzan. Las imágenes y el
  contrato sí.

## 3. LibreOffice de escritorio dentro del instalador

> **Descartada por el mantenedor el 2026-11-23**: la app no depende de otro
> programa de escritorio.

El LibreOffice normal, empaquetado con la app y ejecutado como un proceso
aparte, sin ventana.

**A favor**
- Misma fidelidad, y es la versión más madura y mantenida: publica seguido.
- **No necesita ninguna excepción de seguridad en Chromium.**
- Descifra solo un Office con contraseña.
- Al terminar el proceso, la memoria vuelve entera.

**En contra**
- **Escribe el documento en disco.** Convierte desde archivos, y aunque se
  le pase el documento por memoria, guarda un perfil y archivos temporales.
  Hoy la app nunca escribe el documento en disco
  (`08_Security_Model.md`). Habría que enmendar esa garantía, y en un SSD
  borrar no garantiza que el dato desaparezca.
- **Hay un proceso nativo que controlar**: arrancarlo, esperarlo,
  cortarlo si se cuelga, y comunicarse con él.
- Va un binario distinto por sistema operativo, y en macOS es otro binario
  sin firmar dentro de la app.
- Antivirus que se quejan de un ejecutable que abre documentos. Sin medir.
- Cada actualización de la app baja también LibreOffice, salvo que la
  actualización sea diferencial.

## 4. Renderizadores en JavaScript

Una librería distinta por formato que dibuja el documento como página web,
y Electron la imprime a PDF.

**A favor**
- Liviano, sin excepción de seguridad, todo en memoria.
- Todo el código es nuestro o de librerías chicas.

**En contra**
- **Baja fidelidad.** `docx-preview` no pagina como Word. Para Excel no hay
  un renderizador serio: habría que escribir el paginado de hojas, con el
  área de impresión, los saltos, los anchos y las celdas combinadas. Para
  PowerPoint, las librerías son de calidad dudosa.
- **Un riesgo propio con el Word limpio**: lo que el renderizador no dibuja,
  el usuario no lo ve ni lo revisa, pero el Word limpio igual lo lleva,
  porque sale del XML. Con LibreOffice ese hueco es chico; acá es grande.
- Es la opción con más trabajo y más mantenimiento.

## Descartadas

- **Microsoft Office instalado en la máquina del usuario.** Fidelidad
  perfecta, pero exige que el usuario tenga Office, escribe en disco y
  depende de automatizar otra aplicación.
- **Conversión en la nube** (Google, Microsoft u otro servicio): rompe el
  100 % local.
- **OnlyOffice (x2t)**: licencia AGPL, y no hay un build WASM aparte.

## Recomendación del planificador

**Revisada el 2026-11-23, con el spike de LOWA: la 2, directamente.**

- La 2 ya compiló y anduvo sin la excepción de seguridad, en un Worker
  como el resto del Core, con menos memoria y sin ventana aparte.
- Pasar primero por la 1 sería integrar dos veces lo mismo, con una ventana
  y un `unsafe-eval` que después se tiran.
- El costo que queda es nuestro: recompilar con cada versión de
  LibreOffice. Son entre 75 y 85 minutos en esta máquina, y el CI gratuito
  está sin probar.

La recomendación anterior era la 1 ahora y la 2 como mejora posterior,
porque no se sabía si la 2 compilaba.

**Decisión del mantenedor (2026-11-23): la 2.** Antes de adoptarla se
compara la calidad de su salida con la de la 1 (`Plan_1.2.md` §3 y §8).
- La 3 cambia una garantía central de la app, el documento solo en RAM, a
  cambio de evitar `unsafe-eval` en una ventana aislada.
- La 4 no llega a la fidelidad que pide un Excel como páginas impresas.
