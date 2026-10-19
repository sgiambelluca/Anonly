<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,core/Orchestrator.md,architecture/08_Security_Model.md,ui/React_Client.md,adr/ADR-125-La-Configuracion-Se-Toca-Antes-Del-Primer-Documento.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-223 — Los formatos se configuran desde inicio, se guardan en el equipo y viajan en un archivo

- **Estado**: Aceptado por el mantenedor el 2026-10-19, con los detalles
  técnicos del planificador (`Plan_1.1.md` §4).
- **Fecha**: 2026-10-19.
- **Decidido por**: el mantenedor (2026-10-13 y 2026-10-19), a propuesta del
  planificador en lo técnico.
- **Origen**: `Roadmap_1.x.md` §4 y [`Plan_1.1.md`](../roadmap/Plan_1.1.md).
- **Alcance**: contrato (`EngineConfig`, `Contracts.md` §3 y §6),
  Orchestrator, `react-client` y `08_Security_Model.md` §10.2. Sin cambios
  en el contenedor Electron y sin dependencias nuevas.
- **Relacionado con**:
  - ADR-125: la configuración se toca antes del primer documento y recrea
    el Core;
  - ADR-219, ADR-220 y ADR-221.

## Contexto

### 1. Hoy el Core no recibe formatos ni tipos del usuario

`EngineConfig` no tiene sección de detección (`Contracts.md` §3.1), y nadie
llama a `addPattern` (ADR-219, Contexto §2). La configuración que sí existe
se guarda en `localStorage` (`anonly:settings`). Cuando cambia sin documento
abierto, se recrea el Core (ADR-125 §2).

### 2. El modelo de seguridad solo permite settings en el equipo

`08_Security_Model.md` §10.2 dice: *«`localStorage`: solo settings del
usuario (idioma, modo default, performance preset). Nunca documentos ni
datos sensibles.»* Un formato es configuración, pero el usuario lo escribe,
y un texto fijo podría llevar algo del caso.

### 3. Lo que decidió el mantenedor

El 2026-10-13:

- los tipos creados antes de cargar un documento se guardan; los creados
  con un documento abierto no;
- guardar una definición no autoriza guardar valores detectados,
  apariciones ni contenido del documento.

El 2026-10-19:

- **el generador se abre solo desde la pantalla de inicio**;
- **los formatos se exportan y se importan.** Un usuario experto arma
  formatos y otros los usan. Esto revierte «importación excluida» del
  2026-10-13;
- se exporta lo propio, elegido uno por uno. No viajan el país ni el estado
  de los formatos base;
- al importar, si ya existe un tipo con el mismo nombre, sus formatos se
  suman a ese tipo;
- al borrar un tipo propio se borran todos sus formatos. Los tipos base no
  se borran;
- **se guarda en claro**: son solo formatos, sin datos personales. El
  cifrado queda para el glosario de la 1.4.

## Decisión

### 1. Se configura sin documento abierto, y aplica al siguiente

- **El generador solo está en la pantalla de inicio.** Con un documento
  abierto no hay acceso.
- **Guardar recrea el Core** por el camino de ADR-125 §2, y solo si cambió
  la configuración derivada. Lo nuevo aplica al próximo documento.
- **Ningún cambio de formatos toca un documento abierto**: no hay
  reanálisis, ni preguntas sobre las ediciones que el usuario ya hizo.

### 2. Cómo llega al Core

```ts
// Contracts.md §3.1 y §6
export interface EngineConfig {
  // ...secciones actuales
  readonly detection: DetectionConfig;   // nueva
}

export interface DetectionConfig {
  readonly country: CountryCode;                                 // ADR-221 §1
  readonly baseFormats: ReadonlyArray<BaseFormatSetting>;        // solo el país activo
  readonly userTypes: ReadonlyArray<UserEntityTypeDefinition>;   // ADR-219 §2
  readonly userFormats: ReadonlyArray<FormatDefinition>;         // ADR-220 §1, incluye copias editadas
  readonly catalogRefs: ReadonlyArray<CatalogFormatRef>;         // ADR-221 §5
}

export interface BaseFormatSetting {
  readonly formatId: string;   // id del catálogo
  readonly enabled: boolean;   // un formato base sin entrada está prendido
}
```

- **Default:** Argentina, todos los formatos base prendidos y nada propio.
  Es la detección de la 1.0.2.
- La aplicación deriva `DetectionConfig` de lo que guarda (§3), con el mismo
  mapeo que hoy hace `settingsToEngineConfig`.
- `regex-engine` y `grouping-engine` la leen de `ctx.config`. Es fija
  mientras dura el Core, como el resto de `EngineConfig`.
- `ReanalyzeConfigPatch` **no** la incluye. Con un documento abierto no se
  cambia (§1).

### 3. Qué se guarda, dónde y cómo

En `localStorage`, con una clave propia y versionada (`anonly:detection`),
separada de `anonly:settings`. Se guarda:

- el país activo;
- por cada país, qué formatos base están apagados y las copias editadas;
- los tipos propios, los formatos propios y las referencias a otros países.

**Nunca se guarda:**

- un valor detectado, una aparición ni contenido del documento;
- el texto de la prueba en vivo del generador (ADR-220 §3);
- un tipo del documento (ADR-219 §5).

**En claro.** Son estructuras. El generador exige que cada variante tenga
una pieza de caracteres (ADR-220 §1), y avisa que lo que se escribe en un
formato queda guardado.

`08_Security_Model.md` §10.2 se amplía con esto. «Borrar datos locales»
(§10.1) sigue borrando solo los caches de modelos y WASM, y no los formatos:
los formatos son configuración, como los settings.

### 4. Crear, editar y borrar

- **Tipos y formatos propios:** se crean, se editan y se borran. Borrar un
  tipo propio borra sus formatos, y la confirmación los lista.
- **Tipos base:** no se borran. Sus formatos base se prenden y se apagan, y
  los formatos propios que se les agregaron se borran uno por uno.
- **Formatos base de pura forma:** se editan como copia, con «restaurar
  original» (ADR-220 §4).
- **Formatos de otro país:** se agregan y se quitan como referencia
  (ADR-221 §5).

### 5. Exportar

1. El usuario elige qué tipos y formatos propios exporta. Lo que viaja con
   cada uno:
   - **un tipo propio** viaja con todos sus formatos;
   - **un formato de un tipo propio** viaja con su tipo;
   - **un formato de un tipo base** viaja solo, y nombra su tipo por el
     valor de `EntityType`;
   - **una copia editada** viaja como formato propio, con su `basedOn`;
   - **una referencia a otro país** viaja como referencia.
2. No viajan el país ni el estado de los formatos base.
3. El archivo es JSON:

   ```json
   {
     "kind": "anonly-formats",
     "version": 1,
     "types": [],
     "formats": [],
     "catalogRefs": []
   }
   ```

   Lleva la extensión `.anonly-formatos`.
4. Se baja como cualquier descarga, igual que el PDF exportado. No hace
   falta código nuevo en el contenedor Electron, y el Core no toca el disco
   (R-10).

### 6. Importar

Se importa desde la pantalla de inicio, con el selector de archivos que la
aplicación ya usa para abrir un PDF.

**Primero se valida el archivo entero.** `validateFormatsFile` es una
función pura del Core y usa las mismas validaciones que la creación:

- el esquema y la versión;
- cada tipo, con `validateUserEntityType`;
- cada formato, con `validateFormat`, incluidos los límites y el tipo
  admitido.

Un archivo inválido se rechaza entero, con el motivo, y no se importa nada.
Un archivo de una versión más nueva se rechaza con «creado con una versión
más nueva de Anonly».

**Después se procesa cada elemento:**

| Caso | Qué pasa |
|---|---|
| Tipo con la misma etiqueta que uno existente | Sus formatos se suman al existente |
| Formato idéntico a uno existente (`compareFormat`) | No se importa; figura en el resumen |
| Formato que comparte textos con otro | Se importa con el mismo aviso que al crear |
| Referencia a un formato que no existe en los catálogos de esta versión | No se importa; figura en el resumen |
| Todo lo demás | Se importa prendido, con ids nuevos |

Al terminar se muestra un resumen: qué se importó, qué se sumó a un tipo
existente y qué no se importó, con su motivo.

**Por qué importar es seguro.** El archivo solo puede traer piezas del
generador. No existe una regex escrita a mano que pueda colgar la
aplicación (ADR-220), y todo pasa por la misma validación que una creación.

## Lo que no cambia

- El flujo con documento abierto: configuración, reanálisis de ADR-038 y
  cierre.
- `anonly:settings` y su migración.
- El contenedor Electron: ni IPC nuevo ni permisos nuevos.

## Consecuencias

**A favor**

- Un experto arma un paquete de formatos para su rubro y otros lo importan
  sin escribir nada.
- Lo que se guarda en el equipo sigue sin datos del documento.

**En contra**

- **Una configuración más que recrea el Core** al guardar. Es el mismo
  costo que ya acepta ADR-125.
- **El texto fijo de un formato queda en claro.** La regla de la pieza de
  caracteres y el aviso lo acotan, pero no lo impiden.
- **Un archivo importado puede traer formatos que tapan de más.** Se
  importan prendidos, el resumen los muestra, y cada uno se puede apagar.

## Cómo se verifica

- Una configuración elegida en inicio llega al primer documento que se
  carga después. Es el E2E de ADR-125, ahora con un formato propio.
- Recargar la aplicación conserva tipos, formatos, referencias y ajustes
  por país.
- `anonly:detection` no contiene ningún texto del documento ni de la prueba
  en vivo, después de analizar un documento con formatos propios.
- Exportar un tipo lleva sus formatos, y exportar un formato de un tipo
  propio lleva su tipo.
- Importar:
  - un archivo inválido se rechaza sin importar nada;
  - un tipo con el mismo nombre suma sus formatos;
  - un formato idéntico se saltea y figura en el resumen;
  - una versión futura se rechaza.
- Borrar un tipo propio borra sus formatos. Un tipo base no ofrece borrarse.
