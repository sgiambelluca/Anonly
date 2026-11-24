<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Spike_Imagenes_2026-11-23.md,adr/ADR-239-Una-Imagen-Suelta-Entra-Como-Un-PDF-Armado-Por-Un-Motor-Nuevo.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,adr/ADR-148-Un-Export-Se-Verifica-Leyendo-El-PDF-Exportado.md,adr/ADR-196-Las-Licencias-Del-Software-De-Terceros-Viajan-Con-El-Instalador.md,core/Export_Engine.md,core/Convert_Engine.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-241 — Los PDF se arman con el fork mantenido de pdf-lib

- **Estado**: Propuesto.
- **Fecha**: 2026-11-24.
- **Decidido por**: el planificador. Lo pide `Plan_1.2.md` §10, y el
  mantenedor preguntó por el fork el 2026-11-23.
- **Origen**: `Plan_1.2.md` §10 («Seguir con pdf-lib o pasar al fork
  mantenido») y el spike de imágenes (§8.2).

## Contexto

El Export Engine arma los PDF exportados con `pdf-lib` 1.17.1. En la 1.2,
la librería pasa a tener más trabajo:

- el Convert Engine arma el PDF de una imagen (ADR-239);
- el Convert Engine limpia el PDF que sale del conversor de Office
  (ADR-240 §3);
- el texto preservado y PDF/A van a trabajar sobre PDF ajenos
  (`Plan_1.2.md` §6.4 y §6.5).

Datos del registro de npm, verificados el 2026-11-24:

| | `pdf-lib` | `@cantoo/pdf-lib` |
|---|---|---|
| Última versión | 1.17.1, del 2021-11-06 | 2.11.1, del 2026-09-15 |
| Versiones en 2026 | ninguna | más de diez (2.7.4 a 2.11.1, entre julio y septiembre) |
| Licencia | MIT | MIT |
| Dependencias | `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, `tslib` | `tslib`, `culori`, `fflate`, `node-html-better-parser` |

El fork dice mantener la API y la documentación del original. Suma:

- un parseo más robusto, que recupera PDF truncados;
- cifrado y descifrado de PDF;
- `convertToPDFA()`;
- adjuntos, capas y SVG.

Lo mantiene una empresa para su producto, y no promete soporte fuera de
su hoja de ruta.

El spike de imágenes (`Spike_Imagenes_2026-11-23.md`) corrió el mismo
código con las dos librerías:

- la salida es equivalente: las mismas páginas e imágenes para pdf.js;
- con el fork, la salida es entre 5 y 15 % más chica y hasta 25 % más
  rápida al comprimir;
- el bundle del fork pesa 252 KB con gzip, contra 208 KB.

## Decisión

**La app pasa a `@cantoo/pdf-lib`, con la versión fija exacta**: 2.11.1,
o la última que pase las pruebas al migrar.

1. **Por qué.** El original no publica desde 2021. Con la 1.2 la librería
   lee PDF que no armamos nosotros: los del conversor y, con el texto
   preservado, los del usuario. Leer PDF ajenos con un parser sin
   mantenimiento es el riesgo que este ADR evita. El fork además trae
   `convertToPDFA()`, que el spike de PDF/A evalúa (`Plan_1.2.md` §8).
2. **Versión exacta**, sin rango, en cada `package.json` que la use. Sus
   dependencias declaran rangos abiertos (`>=`). El lockfile las fija, y
   un cambio de versión de cualquiera de ellas pasa por un PR revisable,
   con la auditoría de seguridad de dependencias del repo.
3. **Migración, en un commit propio por módulo** (R-1):
   - el Export Engine;
   - el `package.json` raíz, que también la declara.

   El Convert Engine nace con el fork. Se migra antes de implementar el
   frente 2.
4. **Cómo se verifica.** Pasan sin cambios los tests del Export Engine y
   el gate de lectura del PDF exportado (ADR-148), y se comparan los PDF
   exportados de los fixtures antes y después:
   - el texto extraído, la imagen de cada página y el tamaño;
   - los metadatos por defecto: `Producer` y fechas.

   Una diferencia que no sea de compresión es un hallazgo que se reporta,
   no un test que se ajusta.
5. **Licencias** (ADR-196): el aviso de licencias cambia `pdf-lib`,
   `pako`, `@pdf-lib/standard-fonts` y `@pdf-lib/upng` por el fork y sus
   dependencias.

## Consecuencias

- **Dependencias**: tres paquetes nuevos de terceros (`culori`, `fflate`
  y `node-html-better-parser`) y uno que se va (`pako`, salvo que lo siga
  trayendo `utif2`).
  - `node-html-better-parser` es para dibujar SVG, que la app no usa. Lo
    importa el paquete y no se puede sacar.
- **El bundle crece** unos 44 KB con gzip.
- **Si el fork deja de mantenerse**, la salida es volver al original con
  el mismo código, salvo lo que se use de las funciones nuevas del fork.
  Hoy no se usa ninguna. `convertToPDFA()` se decide en el ADR de PDF/A.
- **Los specs que nombran `pdf-lib`** pasan a nombrar el fork:
  `Export_Engine.md` y `Convert_Engine.md`.
