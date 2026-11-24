<!-- CONTEXT: scope=adr | dependencias=roadmap/Plan_1.2.md,roadmap/formatos/Spike_Imagenes_2026-11-23.md,adr/ADR-239-Una-Imagen-Suelta-Entra-Como-Un-PDF-Armado-Por-Un-Motor-Nuevo.md,adr/ADR-240-Word-Excel-Y-PowerPoint-Entran-Por-Un-LibreOffice-Compilado-Por-Nosotros.md,core/Export_Engine.md,core/Convert_Engine.md | audiencia=humanos+IA | fase=1.2 -->

# ADR-241 — La 1.2 sigue con pdf-lib, y el fork se reabre con PDF/A

- **Estado**: Aceptado por el mantenedor el 2026-11-24, **reabrible**: se
  vuelve a decidir en el ADR de PDF/A (§3).
- **Fecha**: 2026-11-24.
- **Decidido por**: el mantenedor, con los datos del planificador. La
  primera versión de este ADR proponía pasar al fork. El mantenedor
  preguntó para qué servían sus dependencias nuevas y qué mejoraba, y con
  esas respuestas se decidió seguir con el original.
- **Origen**: `Plan_1.2.md` §10 («Seguir con pdf-lib o pasar al fork
  mantenido») y el spike de imágenes (§8.2).

## Contexto

El Export Engine arma los PDF exportados con `pdf-lib` 1.17.1. En la 1.2
también lo usa el Convert Engine, para dos cosas:

- armar el PDF de una imagen suelta (ADR-239);
- limpiar el PDF que sale del conversor de Office (ADR-240 §3).

Datos del registro de npm, verificados el 2026-11-24:

| | `pdf-lib` | `@cantoo/pdf-lib` |
|---|---|---|
| Última versión | 1.17.1, del 2021-11-06 | 2.11.1, del 2026-09-15 |
| Versiones en 2026 | ninguna | más de diez |
| Licencia | MIT | MIT |
| Dependencias | `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, `tslib` | `tslib`, `culori`, `fflate`, `node-html-better-parser` |

**Para qué usa el fork cada dependencia**, revisado en su código:

- **`fflate`** comprime y descomprime el contenido del PDF. Reemplaza a
  `pako`, que hace lo mismo en el original.
- **`culori`** convierte colores escritos como texto (`"#ff0000"`) a
  números. La app pasa los colores como números.
- **`node-html-better-parser`** lee dibujos SVG y formularios XFA. La app
  no los usa, pero el fork la importa siempre, desde `PDFDocument`.

Las dos últimas no aportan nada a la app. Y como el fork las pide con
rangos abiertos (`>=`), una versión nueva podría entrar al actualizar el
lockfile sin que nadie la elija.

**Qué mejora el fork** (`Spike_Imagenes_2026-11-23.md`, con el mismo
código en las dos):

- **La salida es equivalente**: las mismas páginas e imágenes.
- **Armar el PDF de una imagen que no es JPEG** tarda entre 0,5 y 0,8 s
  menos por página, y el PDF sale entre 5 y 15 % más chico.
- **Con un TIFF tarda entre 0,4 y 0,6 s más**, y en algunos casos su pico
  de memoria es más alto.
- **Con un JPEG** no cambia nada.
- **En el export** no se midió.
- **Sus funciones nuevas** (cifrado, SVG, `convertToPDFA()` y la lectura
  de PDF dañados) no las usa la app hoy.

**El argumento a favor del fork es el mantenimiento**: el original no
publica desde 2021. Pesa cuando la librería lee PDF ajenos. En la 1.2 eso
es solo el PDF que arma LibreOffice desde el documento del usuario, no un
PDF que el usuario escribe directo.

## Decisión

### 1. La 1.2 sigue con `pdf-lib` 1.17.1

No se agrega ninguna dependencia. El Convert Engine usa la misma versión
que el Export Engine, como ya dice `Convert_Engine.md`.

### 2. Por qué

- **El costo del fork**: dos dependencias sin uso, con rangos abiertos,
  que hay que auditar y actualizar.
- **Su beneficio hoy**: algo más de velocidad armando el PDF de una imagen
  y el mantenimiento, que todavía pesa poco, porque la app no lee PDF
  escritos por el usuario con esta librería.

El beneficio no alcanza para pagar el costo.

### 3. Cuándo se reabre

**En el ADR de PDF/A**, porque el fork trae `convertToPDFA()`, que podría
ahorrar trabajo. El spike de PDF/A (`Plan_1.2.md` §8) prueba las dos
librerías y valida con veraPDF.

Se reabre también si pasa cualquiera de estas dos cosas:

- **El diseño del texto preservado** (`Plan_1.2.md` §6.4) exige leer o
  modificar el PDF original del usuario con esta librería. Ahí el
  mantenimiento pasa a pesar de verdad.
- **Aparece una vulnerabilidad de `pdf-lib`** que afecte a lo que la app
  hace con él.

Si se reabre y se elige el fork, la migración es la de la primera versión
de este ADR:

- versión exacta en cada `package.json`;
- un commit por módulo;
- la comparación de los PDF exportados de los fixtures antes y después
  (texto, imagen de cada página, tamaño y metadatos por defecto);
- el aviso de licencias actualizado (ADR-196).

## Consecuencias

- **Nada cambia en el código ni en los specs.**
- **El ADR de PDF/A tiene que traer la comparación con el fork**, y
  decidir con ella si este ADR se reemplaza.
