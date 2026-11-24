# Spike LOWA: LibreOffice compilado a WebAssembly por nosotros

> Informe del implementador del spike, copiado sin cambios de
> `C:\Anonly\spikes\lowa\results\INFORME.md` el 2026-11-23. Los scripts,
> los artefactos y el árbol de compilación quedan fuera del repo (en
> `C:\Anonly\spikes\lowa\` y en `~/lowa` de WSL). Qué decide el
> planificador con esto: `Plan_1.2.md` §7 y §8.3.

Fecha: 2026-11-23. Máquina: Windows 11 Pro, 12 hilos, 16 GB de RAM; WSL 2 con Ubuntu 24.04 (7,8 GB de RAM para la VM más 2 GB de swap y 8 GB de swapfile agregado). Electron 44.11.5 del repo, el mismo harness del spike de ZetaOffice (copiado a `C:\Anonly\spikes\lowa\harness\`, con tres cambios: ruta de assets por `--assets`, canvas fuera en el Worker, y un `recorte.mjs` nuevo). No se tocó `C:\Anonly\Anonly` ni `C:\Anonly\spikes\zetaoffice\`.

**Qué sale solo de sintéticos:** todo. Se usó el corpus del spike anterior (generado con `docx`, `exceljs` y `pptxgenjs`). No había `ANONLY_REAL_DOC_*` definidas. No hay ningún documento real en estas mediciones.

## Veredicto por pregunta

| # | Pregunta | Veredicto |
|---|---|---|
| 1 | ¿Compila? | **Sí, a la primera.** LibreOffice 26.8.3.1 (último tag de release con la receta WASM), Emscripten 4.0.10, Ubuntu 24.04. Último tramo de compilación: 4 470 s con `make -j10` sobre 12 hilos (el total desde cero no se midió entero: hubo un tramo previo cortado por el reinicio de la VM; estimo 75 a 85 min). Árbol de trabajo: 9,5 GB. No hubo que arreglar código; solo trampas de entorno (ver más abajo). |
| 2 | ¿Sin interfaz? | **Sí.** La variante headless (`--disable-gui`, sin Qt) compila, arranca y convierte los 9 archivos del corpus. No hizo falta compilar Qt ni usar la receta con GUI. Corre en el documento y **dentro de un Worker sin `document`**. |
| 3 | ¿Sin `unsafe-eval`? | **Sí, solo con reenlazar.** `-sDYNAMIC_EXECUTION=0` elimina `new Function` de Embind: con la CSP estricta de la app (`script-src 'self' blob: 'wasm-unsafe-eval'`) arranca y convierte, 0 violaciones de CSP, 0 apariciones de `new Function` o `eval(` en `soffice.js`. Reenlazar cuesta ~11 min, no una compilación entera. `-sEMBIND_AOT` **no se puede** con los flags de LibreOffice (falla al enlazar, ver §3). Sin pérdida de velocidad medible. |
| 4 | Medido contra ZetaOffice | Ver tabla. Resumen: más liviano en disco y en RAM, pero **arranca ~0,9 s más lento** y convierte algo más lento los archivos grandes. |
| 5 | Recortes | Sí. Sacar la interfaz sobrante y las fuentes no latinas baja `soffice.data` de 97,4 MB a 35,6 MB (arranque 3,5 s a 2,9 s) con PDF idénticos en tamaño y texto idéntico en el análisis. Liberation, Carlito y Caladea no se tocaron. |
| 6 | Mantenimiento | Recompilar cada versión: unos 75 a 85 min con 12 hilos y 9,5 GB de disco; en un runner gratuito de 4 núcleos, estimo 3 a 4 h **[NO CONFIRMADO, no se corrió en CI]**. Entra en el límite de 6 h solo en el runner de 4 núcleos (repos públicos). Ver §6. |

## 1 y 2. Receta exacta (reproducible)

Scripts en `C:\Anonly\spikes\lowa\scripts\` (`00-apt.sh` a `34-receta.sh`); la receta de configure, el parche y las versiones en `scripts\receta\`.

1. Dependencias del sistema (Ubuntu 24.04, como root): `build-essential git zip unzip ccache flex bison gperf perl python3 python3-venv pkg-config libxml2-utils xsltproc nasm autoconf automake libtool curl xz-utils ca-certificates cmake ninja-build libfontconfig-dev libcups2-dev libssl-dev libkrb5-dev gettext openjdk-17-jdk-headless ant`. Es la lista que instalé; **no probé cuál es el mínimo**.
2. Emscripten: `git clone --depth 1 https://github.com/emscripten-core/emsdk.git; ./emsdk install 4.0.10; ./emsdk activate 4.0.10; source emsdk_env.sh`. (4.0.10 es la versión que pide `static/README.wasm.md` del tag. Node 24.19.0 viene en el emsdk.)
3. Fuente: `git clone --depth 1 --branch libreoffice-26.8.3.1 https://github.com/LibreOffice/core.git core` (1,9 GB, 149 225 archivos, commit `861effc5289d539f15c4c18d1ba8579ffd78728b`).
4. `autogen.input` (con el `PATH` **sin** entradas de `/mnt/c`, ver trampas):

```
--disable-debug
--disable-crashdump
--host=wasm32-local-emscripten
--disable-gui
--disable-gen
--disable-scripting
--with-wasm-module=calc impress writer
--with-package-format=emscripten
--enable-ccache
--with-build-platform-configure-options=--enable-ccache
--without-java
--without-doxygen
--disable-cups
--disable-dbus
--disable-gio
--disable-sdremote
--disable-odk
--disable-dconf
--without-help
--without-myspell-dicts
```

   Comando: `./autogen.sh`. Resultado en `config_host.mk`: `DISABLE_GUI=TRUE`, `ENABLE_CUSTOMTARGET_COMPONENTS=TRUE`, `ENABLE_EMSCRIPTEN_PROXY_TO_PTHREAD=TRUE`, `ENABLE_WASM_STRIP_WRITER/CALC=` (incluidos), `ENABLE_NSS=` (sin NSS), `ENABLE_PDFIUM=`, `ENABLE_SKIA=`. Draw y Math quedan fuera por `ENABLE_WASM_STRIP_*`.
   - La receta oficial para headless trae `--with-wasm-module=writer`. El valor por defecto es `calc writer`. Se admiten los tres con `calc impress writer`: **compila y convierte los tres formatos**.
5. Compilar: `make -j10 build` (no existe `build-nocheck`; `make build` no corre tests). Marcador y log fuera del turno: `setsid nohup`.
6. Artefactos: `instdir/program/soffice.{js,wasm,data,data.js.metadata}` (copias idénticas en `workdir/installation/LibreOffice/emscripten/`).

**Artefactos de la compilación base** (con `ASSERTIONS=1` fijo en `solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk`):

| Archivo | Bytes |
|---|---|
| `soffice.wasm` | 154 677 012 |
| `soffice.data` | 97 392 041 |
| `soffice.js` | 749 119 |
| `soffice.data.js.metadata` | 213 644 |

**Tiempos y disco de la compilación.** Último tramo: `build.start` 21:06:01 a `build.end` 22:20:31 (reloj de WSL) = 4 470 s. `ccache` marcó 14 784 llamadas cacheables con 14 370 fallos y 414 aciertos, o sea que casi todo se compiló en ese tramo: 8 069 pasos `CXX` y 253 `LNK` en el log. **El total desde cero no se midió entero**; estimo 75 a 85 min con 12 hilos. Disco: `~/lowa` 9,5 GB (`core` 8,1 GB con `.git`, tarballs externos y `workdir` de 4,1 GB; `emsdk` 1,4 GB; caché de ccache 0,5 GB); `instdir` 831 MB. El pico de RAM del enlazado no se midió; entró en 7,8 GB de RAM más el swap.

**Qué se intentó con GUI:** nada. No hizo falta; la receta sin GUI funcionó.

### Los dos mensajes del log

En `build.log` aparecen dos veces `no magic for .../GenAsmObject/CustomTarget/bridges/gcc3_wasm/generated-asm.d` seguido de `make[1]: *** Deleting file .../libgcc3_uno.a.d`. Es el sistema de dependencias de gbuild descartando un `.d` que no puede interpretar (el objeto se genera con un paso de ensamblador y su archivo de dependencias no tiene el formato de compilador). Efecto: ese `.d` se rehace y la biblioteca puntual (`libgcc3_uno`, el puente UNO de C++) puede considerarse desactualizada. **No afectó nada observable**: la compilación terminó con código 0, los PDF son correctos y los reenlaces posteriores terminaron bien (sin recompilar ningún archivo C++). Para una compilación incremental, lo único esperable es que esa biblioteca chica se recompile cada vez. **[NO CONFIRMADO]** que no haya otra consecuencia.

## 3. Sin `unsafe-eval`: lo que se probó

Todos los reenlaces se hicieron con un gancho de una línea que agregué a `solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk` (parche en `scripts\receta\lo-core.patch`): `gb_LinkTarget_LDFLAGS += $(EXTRA_LO_WASM_LDFLAGS)`. Se usa con `EXTRA_LO_WASM_LDFLAGS='...' make Executable_soffice_bin` y después `make build` (`scripts\32-relink.sh`).

| Variante | Flags extra | Resultado | Tiempo del reenlace | `soffice.wasm` |
|---|---|---|---|---|
| base | (ninguno) | **Falla con CSP estricta**: `script-src` bloquea `eval` (`craftInvokerFunction`, Embind). Con `unsafe-eval` anda. | (la compilación) | 154 677 012 |
| `dynexec0` | `-sDYNAMIC_EXECUTION=0` | **Anda con CSP estricta.** 0 violaciones, 0 `new Function` en `soffice.js` (747 254 B). | 662 s (11 min) | 154 677 012 |
| `aot` | `-sDYNAMIC_EXECUTION=0 -sEMBIND_AOT` | **No enlaza**: `error: .../src/postlibrary.js: undefined exported symbol: "ClassHandle" in EXPORTED_RUNTIME_METHODS`. LibreOffice exporta `ClassHandle` (línea `gb_EMSCRIPTEN_LDFLAGS` de la plataforma) y el modo AOT no lo define. Habría que sacarlo del flag y revisar qué código lo usa. No lo seguí: `dynexec0` ya resuelve el problema sin costo medible. | 165 s hasta el error | |
| `noassert` | `-sDYNAMIC_EXECUTION=0 -sASSERTIONS=0` | Anda. `soffice.js` 709 180 B, wasm 152 047 341 B (-1,7 %). Conversiones 10 a 15 ms más rápidas por archivo; arranque igual. | 582 s | 152 047 341 |

Notas del reenlace: de los ~11 min, el enlace propio (`wasm-ld` más `emscripten-finalize`) toma ~5 min; el resto es gbuild re-chequeando dependencias y regenerando archivos de interfaz (`UIL`, `DEP`) al invocar `make Executable_soffice_bin`. No se recompiló ningún archivo C++ (0 pasos `CXX`). **Reenlazar es mucho más barato que recompilar** (11 min contra ~75 a 85 min).

**El código dinámico que quedaba era solo el de Embind.** Con `DYNAMIC_EXECUTION=0` los 3 lanzamientos con CSP estricta dieron 0 eventos `securitypolicyviolation`, 0 `jsError`, 0 intentos de red.

**Salvedad de la prueba en Worker.** Un Worker cargado desde `app://` **no** hereda la CSP del documento (hallazgo del spike anterior: dentro del Worker `eval` funciona, `evalProbe` dio `2`). Por eso la prueba del Worker no demuestra por sí sola la ausencia de `eval`; lo demuestra la corrida con host en el documento (los hilos de LibreOffice son workers `blob:` que sí están bajo la CSP) y la búsqueda en `soffice.js`.

## 4. Medición contra ZetaOffice

Mismo harness, mismo corpus, `--variant strict` para LOWA, 3 lanzamientos × 3 corridas por archivo. Para ZetaOffice se **repitió la medición el mismo día** con `--variant unsafe-eval` (la única que corre): reproduce los números del spike anterior (arranque 2 623 ms contra 2 604; pico 1,46 a 1,50 GB contra 1,47). Resultados en `results\medicion\` y `results\zeta-rerun\`.

| | ZetaOffice 24.2 (rerun) | LOWA 26.8.3.1 `dynexec0` | LOWA `dynexec0` en Worker | LOWA recortado (rec-B) en Worker |
|---|---|---|---|---|
| CSP | **necesita `unsafe-eval`** | **estricta, 0 violaciones** | estricta, 0 violaciones | estricta, 0 violaciones |
| ¿Corre en un Worker? | No (Qt exige `document`) | Sí | **Sí, sin `document`** (`hasDocument:false`) | **Sí** |
| Disco total | 262 261 407 B | 253 029 951 B | idem | 191 089 319 B |
| Brotli-11 (aprox. instalador) | 52,3 MB (spike previo) | 50,55 MB | idem | ~41,3 MB (wasm 34,44 + datos 6,77 + js 0,11) |
| gzip-9 | 83,6 MB | 80,24 MB | idem | [no medido] |
| Arranque en frío (mediana) | 2 623 ms | 3 546 ms (main), 3 478 ms (Worker) | 3 478 ms | **2 869 ms** |
| Pico de RAM total, WS / privados (MB) | 1 461 a 1 497 / 2 342 a 2 384 | 1 307 a 1 424 / 2 120 a 2 185 | 1 446 a 1 475 / 2 215 a 2 249 | 1 221 a 1 240 / 2 000 a 2 064 |
| RAM tras destruir la página (+10 s) | 1 148 a 1 154 | 1 041 a 1 168 | **472 a 479** (el Worker se libera al navegar) | 462 a 498 |
| RAM tras forzar GC / ventana destruida | 501 a 506 / 347 a 353 | 371 a 440 / 241 a 304 | 413 a 415 / 262 a 265 | 392 a 437 / 262 a 309 |
| Intentos de red | 0 | 0 | 0 | 0 |
| Texto del documento en `userData` (42 cadenas, UTF-8 y UTF-16) | 0 | 0 coincidencias (66 a 68 archivos) | 0 | 0 |
| Almacenamiento (IndexedDB, caches, OPFS, local/session) | vacío | vacío | vacío | vacío |

(Todas las medianas de arranque son del mismo harness; el arranque incluye cargar el wasm y los datos desde `app://` y ver `ready`.)

### Tiempo de conversión por archivo (mediana de las 9 corridas, ms; «1.ª» = primera del proceso)

| Archivo | Zeta 1.ª | Zeta todas | LOWA 1.ª | LOWA todas | LOWA recortado todas |
|---|---|---|---|---|---|
| contrato_carta.docx | 529 | 107 | 692 | 133 | 124 |
| fuentes.docx | 63 | 53 | 65 | 58 | 56 |
| hoja_ancha.xlsx | 196 | 60 | 246 | 71 | 68 |
| hoja_grande.xlsx (162 págs.) | 598 | 569 | 919 | 900 | 793 |
| informe_a4.docx | 56 | 59 | 66 | 61 | 60 |
| largo_40pag.docx | 287 | 272 | 334 | 314 | 304 |
| libro_clientes.xlsx | 156 | 76 | 146 | 64 | 65 |
| oficio.docx | 53 | 49 | 45 | 45 | 44 |
| presentacion.pptx | 325 | 119 | 325 | 117 | 114 |

Sin errores ni timeouts en ninguna de las corridas. `DYNAMIC_EXECUTION=0` no cuesta velocidad: la compilación base con `unsafe-eval` dio los mismos tiempos (arranque 3 527 ms; `hoja_grande` 848 ms contra 900).

### Fidelidad (`analyze.mjs`)

Mismo páginas y tamaños que ZetaOffice en los 9 archivos (2, 1, 4, 162, 2, 34, 3, 1 y 3 páginas; Oficio 612×936 respetado; diapositivas 720×405). Mismos faltantes que ya eran decisiones del filtro: texto oculto, hoja oculta, comentarios y notas del orador (sin `ExportNotesPages`), celdas recortadas por el ancho de columna. Ítems de texto idénticos salvo `fuentes.docx` (31 contra 51: **cambia el reparto de fuentes**, porque LibreOffice 26.8 mapea de otro modo las fuentes de Windows, ver abajo) y `hoja_ancha.xlsx` (613 contra 616). Fuentes embebidas en todos los PDF.

**Diferencia que importa: el tamaño del PDF.** `hoja_grande.xlsx` pasa de 334 KB (Zeta) a **10,1 MB**; el resto sube entre un 15 y 100 % (`informe_a4` 27 a 45 KB; `contrato_carta` 50 a 70 KB; `hoja_ancha` 13 a 104 KB). Causa medida: **el PDF etiquetado (Tagged PDF) de 26.8** escribe una estructura por celda (85 181 `StructElem` en `hoja_grande`). Con `FilterData UseTaggedPDF=false` el mismo archivo da **346 KB** (`informe_a4` 36,8 KB, `largo_40pag` 92 KB). Habrá que decidir si el PDF necesita etiquetas; el texto y las páginas no cambian **[NO CONFIRMADO]** que el texto sea idéntico sin etiquetas (solo se midió el tamaño).

**Mapeo de fuentes** (distinto del de Zeta): `fuentes.docx` muestra Liberation Sans, Carlito, Liberation Serif, Caladea, Liberation Mono y Noto Serif; no aparece DejaVu Sans Mono ni Noto Sans (esas fuentes que Zeta usaba para Consolas, Verdana y Tahoma). **[NO CONFIRMADO]** a qué fuente cae cada una; no se hizo el mapeo fuente por fuente. El salto de línea y de página de las no compatibles puede diferir del de Office (no hay Office aquí).

## 5. Recortes de `soffice.data`

Lo que pesa dentro de los 97,4 MB (descomprimidos, por el índice):

| Grupo | MB |
|---|---|
| `share/fonts/truetype` (128 archivos) | 51,0 |
| `share/config/soffice.cfg` (1 651 archivos, interfaz `.ui` y menús) | 29,7 |
| `share/config/images_colibre.zip` | 2,8 |
| `share/registry/main.xcd` | 1,9 |
| `share/filter/oox-drawingml-cs-presets` | 1,6 |
| `share/liblangtag` (registro de idiomas) | 1,7 |
| galería (`gallery/fontwork.*`) | 0,9 |
| `program/types/*.rdb` (UNO) | 1,1 |

Los recortes se hacen **sin recompilar**: `harness\recorte.mjs` reescribe `soffice.data` y su `.metadata` sacando archivos. Probados con la CSP estricta, 3×3, los 9 archivos:

| Perfil | Qué saca | `soffice.data` | Resultado |
|---|---|---|---|
| (ninguno) | | 97,4 MB | referencia |
| `rec-A` | `soffice.cfg` salvo `modules/simpress`, más `images_*.zip`, galería, `/android` e imagen de bienvenida (26,8 MB) | 66,1 MB | **PDF idénticos en tamaño y análisis**; arranque 3 518 ms |
| `rec-B` | `rec-A` más fuentes que no son Liberation, Carlito, Caladea, OpenSymbol, DejaVu Sans/Sans Mono/Serif (sin Condensed, ExtraLight ni Math) ni Noto Sans/Serif latinas (58,9 MB en total) | **35,6 MB** | **PDF idénticos en tamaño y análisis (`analyze.mjs` da lo mismo en los 9)**; arranque **2 869 ms**; 41 de 128 fuentes quedan |

Qué salió: las fuentes de Linux Libertine y Biolinum (~21 MB), Amiri, Scheherazade, Noto árabe, hebreo, armenio, georgiano, lao, Frank Ruhl y similares (CLM), Rubik, Reem Kufi, Alef, David, Miriam y Nachlieli, y las DejaVu condensadas.

**Cosas que descubrí que NO se pueden sacar:**
- Sacar **todo** `soffice.cfg` (incluidos los `.ui`) rompe la carga: `loadComponentFromURL devolvió null` en docx y xlsx y, en pptx, `memory access out of bounds`. Sacar solo los menús y barras (no `.ui`; 1,8 MB) rompe solo el `.pptx`. Sacar cualquiera de `modules/swriter`, `modules/scalc`, `modules/sdraw`, `modules/schart`, `cui/ui`, `svx/ui` o `sfx/ui` por separado no rompe nada. **Sacar `modules/simpress` rompe Impress** (`table index is out of bounds`).
- Con las fuentes recortadas, las escrituras no latinas (árabe, hebreo, etc.) quedarían sin fuente propia. **No se probó** con documentos en esas escrituras (el corpus es en español); hay que decidir si hacen falta.

Efecto en el instalador: brotli 50,55 MB a ~41,3 MB (-9,3 MB), disco 253 MB a 191 MB (-62 MB). El `.wasm` (154,7 MB; 34,4 MB comprimido) es lo que queda: **no se puede achicar sin recompilar** (se podría sacar módulos con otro `--with-wasm-module`, o activar LTO/`-Oz`; no se probó **[NO CONFIRMADO]**).

## 6. Mantenimiento: seguir las versiones de LibreOffice

Para cada versión nueva (por ejemplo 26.8.4):
1. `git clone --depth 1 --branch libreoffice-<versión> ...` (~2 min, 1,9 GB; falló con «hung up» tres veces cuando se lanzó en segundo plano y anduvo en primer plano).
2. Aplicar el parche de una línea (`scripts\receta\lo-core.patch`) **solo** si se quiere reenlazar sin recompilar; para una compilación limpia con `-sDYNAMIC_EXECUTION=0` se puede poner el flag directo en el parche.
3. `./autogen.sh` con el `autogen.input` de arriba (~5 min) y `make build`.
4. Con `ccache` caliente la compilación debería bajar mucho; no se midió **[NO CONFIRMADO]**.
5. Recortar con `recorte.mjs` (30 s) y probar con los 9 archivos (~2 min por perfil).

**Tiempo de máquina:** ~75 a 85 min de pared con 12 hilos y `-j10` en esta máquina (compilación desde cero). **Disco:** ~9,5 GB (más swap).

**¿Entra en GitHub Actions gratuito?**
- **Tiempo:** 6 h por job. Con repo público (runner de 4 vCPU y 16 GB), el trabajo de ~75 min a 10 hilos escala a unas 3 a 3,5 h (por 4 núcleos), más enlace y empaquetado: ~4 h **[estimación, no corrida]**. Con repo privado (2 vCPU, 7 GB), ~6 h o más: **no entra** de manera segura.
- **Disco:** ~14 GB libres. Los 9,5 GB del árbol entran justo, sin margen para swap (el enlace se hizo con 7,8 GB de RAM y swap; un runner de 16 GB no debería necesitarlo, pero **no se midió** el pico del enlace). Habría que limpiar el árbol del runner antes y borrar `workdir` por etapas.
- **RAM del enlace:** la receta oficial advierte hasta 64 GB; aquí no hizo falta, pero hubo swap disponible.
- **ccache** entre ejecuciones (cache de Actions, 10 GB de límite por repo) reduciría las siguientes corridas mucho; no se midió.
- Alternativa: compilar en esta máquina (75 a 85 min) y subir los 4 archivos al release del proyecto.

El mantenimiento incluye volver a verificar, en cada versión, los puntos que rompieron o cambiaron aquí: flag de reenlace, tamaño del PDF etiquetado y mapeo de fuentes.

## Trampas

- `configure` aborta con `for the moment strawberry-perl-portable is a requirement` si el `PATH` de WSL contiene `/mnt/c/.../mingw64` (lo interpreta como un build de Windows desde WSL). Filtrar `/mnt/*` del `PATH` antes de `./autogen.sh` y de `make`.
- `make build-nocheck` no existe. `make build` no corre los tests.
- `git clone --depth 1` de LibreOffice falló con «the remote end hung up unexpectedly» cuando se lanzó en segundo plano con opciones HTTP/1.1 y funcionó en primer plano y sin opciones.
- Un `nohup` suelto muere al cerrarse la sesión de `wsl`; hay que usar `setsid nohup`.
- La VM de WSL se reinició dos veces (se pierde el swap agregado y, si hay un `make` en curso, se detiene). Hay que reactivar el swapfile con `swapon` como root y relanzar `make`, que retoma.
- `pkill -f "git clone"` desde un `bash -c` que lo contiene en su propia línea mata el propio shell.
- Desde Git Bash, `wsl -d Ubuntu -- bash /mnt/c/...` convierte mal la ruta: se invoca por `powershell.exe -Command "wsl ..."` y con scripts `.sh` en archivo (sin comillas anidadas).
- `make Executable_soffice_bin` regenera ~1 500 archivos de interfaz y dependencias antes de enlazar (~5 min de más, no es el enlace).
- `-sEMBIND_AOT` no enlaza con los flags de LibreOffice (`ClassHandle`).
- `ASSERTIONS=1` está fijo en la plataforma; se puede pisar con `-sASSERTIONS=0` (gana el último flag).
- El primer PDF de LibreOffice 26.8 con `Tagged PDF` por defecto pesa 10 MB para una hoja de 5 000 filas; ver §4.

## No verificado

- Compilación desde cero entera cronometrada (solo el último tramo de 4 470 s).
- Pico de RAM durante el enlace; compilación en un runner de GitHub Actions.
- Office cifrado: el build no tiene NSS (`ENABLE_NSS=` vacío), así que casi seguro **sigue sin abrir** archivos cifrados igual que ZetaOffice. **No se probó** abrir uno; compilar con NSS no se intentó.
- Documentos reales y escrituras no latinas con el recorte de fuentes.
- Arranque con caché de archivos del sistema fría.
- Licencias: el binario se compila de código abierto (MPL 2.0 y las licencias de lo incluido); no hay Qt en esta variante, así que **desaparece la obligación de LGPL por Qt estático** del build de allotropia **[CONOCIMIENTO PREVIO, NO CONFIRMADO por un abogado]**. Las fuentes que quedan (Liberation, Carlito, Caladea, DejaVu, Noto) son libres [CONOCIMIENTO PREVIO].
- Por qué el arranque es 0,9 s más lento que ZetaOffice (no se perfiló).

## Archivos

- Informe: `C:\Anonly\spikes\lowa\results\INFORME.md`.
- Artefactos: `C:\Anonly\spikes\lowa\artefactos\` (`lowa-base`: con `eval`; `dynexec0`: sin `eval`; `noassert`; `rec-A` y `rec-B`: recortados).
- Mediciones: `results\medicion\`, `results\zeta-rerun\`, `results\fidelidad-*`, `results\compresion\`, `results\sin-tags\`.
- Harness: `harness\` (`main.js`, `measure.mjs`, `analyze.mjs`, `recorte.mjs`, `data-groups.mjs`).
- Receta y parche: `scripts\receta\`.
