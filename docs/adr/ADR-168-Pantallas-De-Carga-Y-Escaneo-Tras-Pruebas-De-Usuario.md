<!-- CONTEXT: scope=adr | dependencias=adr/ADR-087-La-Herramienta-Tiene-Tres-Momentos-No-Cuatro-Paneles.md,adr/ADR-070-Atribucion-Visible-En-El-Producto.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-150-La-Pantalla-De-Escaneo-Dura-Lo-Que-Dura-El-Escaneo.md,adr/ADR-152-La-Pantalla-De-Escaneo-Dice-En-Que-Pagina-Va.md,adr/ADR-060-Reemplazo-Por-Genero.md,adr/ADR-131-El-Actualizador-Es-La-Primera-Salida-De-Red.md,ui/UX_Guidelines.md,ui/Components.md | audiencia=humanos+IA | fase=12.5 -->

# ADR-168 — Pantallas de carga y escaneo tras las pruebas de usuario

- **Estado**: Accepted
- **Fecha**: 2026-09-23
- **Decidido por**: El humano, sobre las pruebas de usuario de la 0.9.2 y el lienzo de diseño
  "Anonly — Nueva pantalla inicial" (páginas *Inicio y carga*).
- **Reemplaza**: ADR-070 §1 (la sección "Acerca de" vive dentro de `SettingsDialog`).
  `UX_Guidelines.md` §7.5 y ADR-150 **solo** para los fallos de importación (§4).
- **Extiende**: ADR-152 (la pantalla de escaneo gana un flujo de cuatro pasos, §5).
  ADR-070 §3 (dos URLs externas nuevas, §3).
- **Relacionado con**: ADR-087 §1 (los tres momentos), ADR-125 §1 (Configuración desde la
  pantalla de carga), ADR-131 §5 (el aviso de la salida de red), ADR-169 (la regla de diseño
  estable, que también rige acá).
- **Parte de**: Hito 12.5 — Rediseño desde las pruebas de usuario

## Contexto

### 1. La primera pantalla cumple, pero se lee vacía

ADR-087 §1 dejó la pantalla de carga con lo mínimo: logo, una frase, la zona de carga y tres
rasgos del producto. Es correcto en contenido y las pruebas de usuario lo confirmaron: nadie dejó
de encontrar dónde soltar el PDF. Lo que reportaron es otra cosa: la pantalla **se siente vacía**
y **no explica cómo funciona la herramienta**. El usuario llega a ②b sin saber que después de
detectar puede revisar, ni que el PDF final se reconstruye.

### 2. "Acerca de" está en el lugar equivocado

ADR-070 §1 puso los créditos dentro de `SettingsDialog` porque en ese momento no había otro lugar.
En las pruebas, "Acerca de" en medio de un formulario de configuración se lee como un campo más, y
el enlace para reportar un problema quedó escondido dos niveles adentro.

### 3. Dos enlaces externos existen sin ADR

`SettingsDialog` muestra hoy "Ver el código fuente en GitHub" y "Reportar un problema"
(`REPOSITORY_URL`, entraron con el Hito 11.5). ADR-070 §3 dejó una regla explícita: los dos
enlaces del crédito son **las únicas URLs externas navegables del producto**, y cualquier otra
necesita su propio ADR. Estas dos no lo tienen. No es un problema de seguridad —son `<a href>`
fijos, no requests de la app, igual que los del crédito—, pero es una regla vigente sin cumplir.

### 4. Un PDF inválido deja al usuario en una pantalla que no sirve

Hoy un `PIPELINE_FAILED` por `PDF_INVALID` pasa de inmediato a ②b (ADR-150) y se informa con el
banner de `UX_Guidelines.md` §7.5, cuya única salida es "Cerrar documento". El usuario termina en la
pantalla de trabajo **sin documento que trabajar**, lee el error arriba, cierra y vuelve a la
pantalla de carga. Son dos pasos para llegar al lugar donde tiene que estar: la zona donde se suelta
el archivo.

### 5. "Leyendo" y "Escaneando" no son lo mismo, y el usuario no lo sabe

ADR-152 dio a cada etapa su rótulo y su contador. En las pruebas, el usuario vio "Leyendo el
documento… página 3 de 12" y después "Escaneando el documento… página 1 de 12" y lo interpretó como
que el análisis **volvió a empezar**. Cada rótulo es correcto; lo que falta es el mapa: cuántos pasos
hay y en cuál está.

## Decisión

### 1. La pantalla de carga se reorganiza en cajas

Mismo contenido de ADR-087 §1, más dos cosas nuevas, cada bloque en su propia caja:

- **Barra superior** (caja): logo, nombre y `SettingsButton` (ADR-125 §1 intacto).
- **Caja principal**: título, bajada y la **zona de carga** (§2).
- **Caja "Cómo funciona"**: una animación en tres fases (entra el documento → la lupa marca datos
  por tipo → los datos se tapan y aparece un check) sincronizada con tres pasos escritos
  (*Cargá el PDF · Revisá lo detectado · Exportá la copia*).
- **Tres tarjetas** con los rasgos: *Todo local*, *Detección automática*, *No se puede deshacer*.
  Sus textos no repiten los pasos de la caja "Cómo funciona": las tarjetas dicen **qué garantiza**
  la herramienta, los pasos dicen **qué hace el usuario**.
- **Pie de página** (caja): versión y licencia, y dos botones: **"Acerca de…"** (§3) y
  **"Reportar un problema"** (§3).

Toda la animación vive detrás de `prefers-reduced-motion: no-preference` (`UX_Guidelines.md` §9),
como la de hoy.

### 2. La zona de carga tiene cuatro estados, en el mismo recuadro

| Estado | Cuándo | Qué muestra |
|---|---|---|
| Reposo | sin archivo | borde punteado animado, "Arrastrá un PDF acá", "Elegir archivo", "Solo archivos PDF" |
| Arrastrando encima | `dragover` | borde continuo de acento, "Soltá el archivo para abrirlo · Se abre acá mismo, no se sube a ningún lado" |
| Abriendo | entre el drop y `DOCUMENT_IMPORTED` (el `busy` actual) | anillo que gira, nombre del archivo, "Elegir archivo" deshabilitado |
| Error | archivo rechazado (§4) | borde de error, "No se pudo abrir el archivo", el motivo, "Elegir otro archivo" |

**El recuadro no cambia de tamaño entre estados** (regla de diseño estable, ADR-169 §1).

### 3. "Acerca de" sale de Configuración y pasa al pie de la pantalla de carga

- **Reemplaza ADR-070 §1.** La sección deja `SettingsDialog` y pasa a un diálogo propio,
  `AboutDialog`, que se abre desde el botón "Acerca de…" del pie de `LoadScreen`.
- Contenido: código fuente (enlace al repositorio) y **Datos de terceros**, con cada entrada de
  `THIRD_PARTY_CREDITS` (título, titular, licencia, cambios, para qué se usa). ADR-070 §2 (los
  créditos son datos), §4 y §5 (el test de sincronización con `NOTICE` y el provenance) **no
  cambian**: cambia dónde se muestra, no qué se muestra ni cómo se verifica.
- `SettingsDialog` gana una línea al pie que dice dónde quedaron los créditos, para quien los busque
  donde estaban.
- **Obligación de licencia**: CC-BY exige crédito **visible en el producto** (ADR-060 §11). Sigue
  cumplida: la pantalla de carga es la primera que ve todo usuario, así que es más visible que antes.

**Extiende ADR-070 §3 con dos URLs**, que pasan a ser las cuatro únicas URLs externas navegables:

| URL | Dónde |
|---|---|
| `https://github.com/sgiambelluca/Anonly` | `AboutDialog`, "Código fuente" |
| `https://github.com/sgiambelluca/Anonly/issues/new` | botón "Reportar un problema" del pie de `LoadScreen` y de `AboutDialog` |

Mismo razonamiento que ADR-070 §3: son `<a href>` fijos y commiteados, `target="_blank"
rel="noopener noreferrer"`, que abre **el usuario**; no son requests de la app y `connect-src
'self'` sigue sin excepciones. **Con esto se regulariza** que hoy ya existan en `SettingsDialog` sin
ADR (Contexto §3). La regla de ADR-070 §3 sigue en pie para cualquier enlace nuevo.

### 4. Un fallo de importación vuelve a la zona de carga

- **Qué es un fallo de importación**: un `PIPELINE_FAILED` que llega cuando la última etapa
  observada fue `Importing` o `Extracting`, o sea antes de que el documento tenga páginas que
  revisar. Lo determina la UI con lo que ya tiene: `pipeline.store` registra la etapa previa al
  `Failed`. **Sin cambio de contrato**.
- **Qué pasa**: la UI cierra el documento (`DOCUMENT_CLOSED`, el mismo camino que
  `CloseDocumentButton`) y vuelve a ①, con la zona de carga en estado **Error** y el motivo del
  fallo (`pipelineErrorPresentation.ts`), con el nombre del archivo. El usuario puede soltar otro
  archivo sin un paso intermedio.
- **Qué no cambia**: un `PIPELINE_FAILED` en cualquier etapa posterior (`OCRing`, `Detecting`,
  `Grouping`: por ejemplo `NER_MODEL_MISSING`) sigue pasando a ②b con el banner de §7.5, porque
  ahí **sí** hay un documento cargado. `PDF_PASSWORD_REQUIRED` no es un fallo y sigue abriendo
  `PasswordDialog`.
- **Reemplaza a ADR-150** solo en esto: "`Failed` ⇒ pasa de inmediato" ahora dice "pasa de
  inmediato a ② si hay documento que revisar; a ① si falló la importación".

### 5. La pantalla de escaneo muestra un flujo de cuatro pasos fijos

Una caja nueva entre la animación y la barra de progreso, con cuatro pasos que **siempre** están:

| Paso | Etapas (`PipelineStage`) | Pendiente / en curso / terminado |
|---|---|---|
| 1. Abrir | `Importing`, `Extracting` | Abriendo → **Abierto** |
| 2. Leer | `OCRing` | Leyendo → **Leído** |
| 3. Escanear | `Detecting` (incluida la carga del modelo) | Escaneando → **Escaneado** |
| 4. Ordenar | `Grouping` | Ordenando → **Ordenado** |

- **El paso 2 aparece siempre, aunque no haya OCR.** Si el pipeline pasa a `Detecting` sin haber
  pasado por `OCRing`, el paso 2 se marca terminado con la aclaración *"El PDF ya tenía texto"*.
  **La cantidad de pasos no depende del documento**: una UI que agrega o quita pasos según el caso
  cambia de forma mientras el usuario la mira. Se descartó explícitamente mostrar tres pasos cuando
  no hay OCR.
- Cada paso lleva una línea que dice qué hace (*Carga el archivo · Saca el texto de cada página ·
  Busca datos sensibles · Agrupa lo encontrado*). Es lo que resuelve el Contexto §5: "leer" y
  "escanear" se ven como dos trabajos distintos.
- **ADR-152 no cambia**: los rótulos de estado, los contadores y la regla del denominador
  (`pageCount`) siguen iguales en la caja de progreso. El flujo de pasos es un mapa encima, no un
  reemplazo.
- Se deriva **solo** de `PipelineStage` en la UI. Sin cambio de contrato.

### 6. La caja de progreso y la de la animación son cajas

La animación del documento con la lupa va en su propia caja (con el archivo y su cantidad de páginas
arriba), y la barra de progreso con "Cancelar" en otra, separada. El atajo de cancelar (`Ctrl+.`) se
muestra junto al botón.

## Consecuencias

**A favor**

- El usuario entiende el flujo antes de cargar y durante el escaneo, sin leer documentación.
- Un PDF inválido se corrige donde se produjo, en un paso.
- Se regulariza una regla de ADR-070 que estaba incumplida.

**En contra**

- `LoadScreen` pasa de ~190 a varios cientos de líneas y suma una animación. Se mitiga dividiéndolo
  en componentes (`HowItWorks`, `DropZone`, `AboutDialog`).
- La etapa previa al `Failed` pasa a ser estado de la UI. Si el Orchestrator algún día emite
  `Failed` sin pasar por la etapa en curso, la clasificación de §4 falla hacia el caso conservador
  (banner en ②b), que es el comportamiento de hoy.

**Lo que no toca**

- `Contracts.md`, el Core y los motores.
- El contenido y la verificación de los créditos (ADR-070 §2, §4, §5).
- ADR-152: rótulos, contadores y denominador.

## Documentación que cambia

- `ui/UX_Guidelines.md` §2.1 (pantalla de carga), §7.3 (flujo de pasos), §7.5 (fallo de
  importación).
- `ui/Components.md` §2.6 (sin "Acerca de"), §2.9 (`LoadScreen`, `DropZone`, `AboutDialog`),
  §2.10 (`ScanScreen`, flujo de pasos).
- `ui/React_Client.md` §3.4 (`pipeline.store` registra la etapa previa al fallo).
- `adr/ADR-070` (nota de reemplazo parcial en §1 y §3).
