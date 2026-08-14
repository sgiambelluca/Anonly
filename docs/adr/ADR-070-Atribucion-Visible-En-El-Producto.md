<!-- CONTEXT: scope=adr | dependencias=ui/Components.md,ui/UX_Guidelines.md,architecture/08_Security_Model.md,adr/ADR-036-Auditoria-Pre-Hito10-React-Client-Workers.md,adr/ADR-060-Reemplazo-Por-Genero.md,adr/ADR-069-Lexico-De-Genero-Fuente-Unica-Y-Canal-Del-Usuario.md | audiencia=humanos+IA | fase=10.6 -->

# ADR-070 — Atribución de terceros visible en el producto

- **Estado**: Accepted
- **Fecha**: 2026-08-14
- **Decidido por**: El humano, al resolver el bloqueante que el revisor levantó sobre la branch del Hito 10.6: eligió alojar la atribución como una sección "Acerca de" dentro del `SettingsDialog` existente —en vez de un componente nuevo en el Toolbar— y que los enlaces al dataset y a la licencia sean **clicables**.
- **Relacionado con**: ADR-060 §11 (la obligación de licencia, que este ADR no crea sino que aterriza), ADR-069 §1 (la fuente única, que reduce la atribución a una sola licencia), ADR-036 §7 (el `SettingsDialog` donde se inserta), ADR-018 (el criterio de auditabilidad de assets de terceros)
- **Parte de**: Hito 10.6, PR 12b

> Convención de citas: `ADR-070 §N` refiere a **Decisión §N**; el contexto se cita como `ADR-070, Contexto §N`.

## Contexto

### 1. La obligación existe desde ADR-060 §11 y sigue sin cumplirse

ADR-060 §11 es explícito: el aviso de atribución CC-BY tiene que ser **visible en el producto** (créditos / "Acerca de"), y un `NOTICE` en el repo **no alcanza**, porque la app se distribuye como sitio estático y quien la usa tiene que poder ver el crédito sin clonar el repositorio.

Lo que ya está cumplido, y no es poco: `NOTICE` completo con la fuente única de ADR-069 §1 (la atribución de UCI ya fue retirada junto con el dato), la sección "Atribución de datos de terceros" en `README.md`, y `packages/anonymization-core/grouping-engine/assets/gender-lexicon.provenance.json` con URL del dataset, URL del recurso, licencia, fecha de descarga, `sha256` del artefacto y conteos.

Falta exactamente una cosa: **la superficie en la interfaz**. El propio `NOTICE` lo dice en su cabecera, y el ítem sigue sin tachar en `ADR-060` §"Validación" y `ADR-069` §"Validación".

### 2. Llegó hasta acá porque ningún PR se hizo cargo

ADR-060 §12 ató la atribución visible al PR 12 (`apps/react-client`). Cuando ADR-069 partió el PR 11 en 11a/11b/11c, el PR 12 se implementó con lo que tenía spec —`PersonGenderSelect` y la marca de "sin determinar", que `ui/Components.md` §3.4b describe campo por campo— y la atribución quedó afuera, porque **no tenía spec que implementar**.

Eso no fue un descuido del implementador: fue la respuesta correcta a una ambigüedad real (`ai/AI_Development_Guide.md` §5). ADR-060 §11 fija el **qué** con precisión y no dice nada del **dónde**: "créditos / 'Acerca de'" nombra dos superficies posibles, y ninguna de las dos existe.

### 3. No hay dónde ponerlo hoy

`ui/UX_Guidelines.md` §2 define un layout de Toolbar + 4 paneles a pantalla completa. No hay footer, no hay barra de estado, no hay pantalla de "Acerca de". Y `ui/Components.md` no menciona créditos, atribución ni "Acerca de" en ninguna de sus 14 secciones.

El único contenedor existente que se abre desde el Toolbar y no es una acción del pipeline es el `SettingsDialog` (§2.6, ADR-036 §7), cuyo trigger —el engranaje— está **siempre visible**, con documento abierto o sin él.

### 4. El léxico no va a ser el último crédito

El producto ya depende de terceros con requisito de aviso más allá de este dataset: `pdf.js`, Tesseract y `onnxruntime-web` son Apache-2.0, que exige propagar el `NOTICE` del proyecto original. Ese cumplimiento **no es alcance de este ADR** —no lo introdujo el Hito 10.6 y auditarlo entero es un trabajo propio—, pero condiciona la forma de la solución: la superficie que se elija ahora tiene que poder crecer sin rehacerse.

## Decisión

### 1. Sección "Acerca de" dentro del `SettingsDialog`, no un componente nuevo

La atribución vive como un bloque al pie del `SettingsDialog` (`ui/Components.md` §2.6), separado del formulario por un divisor y encabezado por "Acerca de".

Por qué ahí y no en un `AboutDialog` propio: el engranaje ya está siempre visible en el Toolbar, así que la atribución queda a un clic desde cualquier estado de la app sin agregar un octavo control a un Toolbar que ya tiene siete. Un diálogo nuevo cuesta un componente, un trigger, un test de visibilidad y una entrada en la estructura de §1 — para mostrar el mismo párrafo.

**El bloque es de solo lectura y está fuera del guardado atómico del diálogo.** No lee ni escribe `settings.store`, no participa del `diffReanalyzeChange`, y ni "Cancelar" ni "Guardar" lo afectan. Esto es una restricción, no un detalle: `SettingsDialog` garantiza hoy que si el usuario cancela, **ningún** campo se aplica; un bloque estático no puede introducir una excepción a esa regla.

### 2. Los créditos son datos, no JSX

La lista vive en un módulo propio, `apps/react-client/src/components/toolbar/thirdPartyCredits.ts`:

```ts
export interface ThirdPartyCredit {
  readonly id: string;
  /** Título de la obra, como lo nombra la fuente. */
  readonly title: string;
  /** Titular de los derechos, como pide CC-BY. */
  readonly holder: string;
  /** Nombre legible de la licencia, p. ej. "CC-BY-2.5-AR". */
  readonly license: string;
  readonly licenseUrl: string;
  readonly sourceUrl: string;
  /** Indicación de cambios: CC-BY la exige cuando la obra se modificó. */
  readonly changes: string;
  /** Para qué lo usa Anonly, en una línea. */
  readonly usedFor: string;
}

export const THIRD_PARTY_CREDITS: ReadonlyArray<ThirdPartyCredit> = [ /* … */ ];
```

Hoy tiene **una** entrada. Separar los datos del componente es lo que hace que sumar las licencias de Contexto §4 sea agregar filas a un array, y —más importante— es lo que permite testear el contenido sin renderizar nada: los tests de `apps/react-client` corren con `environment: node`, sin jsdom ni testing-library (`vitest.config.ts`), y el repo ya resuelve esto extrayendo la lógica a módulos puros (`personGenderVisibility.ts`, `personGenderOptions.ts`, `exportButtonVisibility.ts`).

La entrada del léxico dice, literalmente:

| Campo | Valor |
|---|---|
| `title` | `Nombres — recurso "Nombres Permitidos"` |
| `holder` | `Gobierno de la Ciudad de Buenos Aires — Buenos Aires Data` |
| `license` | `CC-BY-2.5-AR` |
| `licenseUrl` | `https://creativecommons.org/licenses/by/2.5/ar/` |
| `sourceUrl` | `https://data.buenosaires.gob.ar/dataset/nombres` |
| `changes` | `Datos modificados: se conservan solo el nombre y el sexo declarado, normalizados; se descartan origen y significado.` |
| `usedFor` | `Sugerir el género de los reemplazos de personas.` |

Los cuatro elementos que CC-BY exige —obra, titular, licencia con su URI, e indicación de que hubo cambios— están los cuatro, y coinciden con `gender-lexicon.provenance.json` y con `NOTICE`. Que sigan coincidiendo lo garantiza un test (§5), no la disciplina.

### 3. Los enlaces son clicables, y son las únicas URLs externas del producto

El título de la obra enlaza a `sourceUrl` y el nombre de la licencia a `licenseUrl`, ambos con:

```tsx
<a href={…} target="_blank" rel="noopener noreferrer">
```

Por qué esto no contradice el modelo de `08_Security_Model.md` §3.2: un `<a href>` **no es una request de la app**. `connect-src 'self'` queda intacto y sigue sin admitir excepciones; nada se descarga de un tercero en runtime; ningún dato del documento toca la red. Lo que ocurre es una navegación en otra pestaña que **inicia el usuario**, sobre dos URLs fijas y commiteadas, no derivadas de ningún contenido del documento.

`noopener` corta el acceso a `window.opener` desde la pestaña destino y `noreferrer` evita anunciarle el origen: la pestaña nueva no aprende ni de dónde vino ni quién la abrió.

**Regla que este ADR deja puesta**: estas dos son las únicas URLs externas navegables del producto. Cualquier enlace externo adicional —soporte, documentación, redes— necesita su propio ADR. La razón es que en una app cuya promesa es "nada sale del navegador", cada enlace hacia afuera es una decisión de producto, no una de maquetado.

### 4. Qué **no** es esta sección

- **No** es una pantalla "Acerca de" completa: sin versión, sin número de build, sin changelog, sin logo. Si alguna vez hacen falta, es otro ADR y probablemente el `AboutDialog` que este ADR no construye.
- **No** cubre las licencias de código del stack (Contexto §4). Queda anotado en `roadmap/Future_Ideas.md`; el `THIRD_PARTY_CREDITS` de §2 es el lugar donde entrarán.
- **No** toca `ui/UX_Guidelines.md`: el layout no cambia, el Toolbar no gana controles y no hay interacción nueva que documentar. El texto exacto y la estructura viven en `ui/Components.md` §2.6.

### 5. Tests

`apps/react-client` (PR 12b), todos sobre el módulo de datos, sin DOM:

- Unit: `THIRD_PARTY_CREDITS` no está vacío y **toda** entrada tiene los ocho campos no vacíos. Es el test que hace que una entrada nueva mal cargada no llegue a producción.
- Unit: la entrada `buenos-aires-nombres-permitidos` coincide con `gender-lexicon.provenance.json` en `sourceUrl` (`source.datasetPage`) y `license` (`source.license`). **Este es el test que importa**: impide que el crédito visible y la procedencia auditable se desincronicen cuando alguien regenere el artefacto desde otra fuente.
- Unit: todas las URLs usan esquema `https:`.
- E2E: en `tests/e2e/scenario-9-ner-runtime-reanalyze.spec.ts`, que **ya abre el `SettingsDialog`**, una aserción de que el crédito y el enlace a la licencia son visibles. Es la única prueba que verifica de verdad el enunciado "visible en el producto", y no cuesta una corrida nueva porque el escenario ya existe.

### 6. Alcance: un PR

| # | PR | Módulo | Depende de |
|---|---|---|---|
| 12b | Sección "Acerca de" con la atribución CC-BY | `apps/react-client` | PR 12 |

Con el PR 12b se cierran, en el mismo cambio: el párrafo "IMPORTANTE … pendiente" del `NOTICE`, el ítem de atribución visible en `ADR-060` §"Validación" y en `ADR-069` §"Validación", y los estados del bloque del Hito 10.6 en `roadmap/MVP.md` §4. Se cierran **con** el código y no antes: hasta que la sección exista, tacharlos sería declarar cumplida una obligación de licencia que no lo está.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
|---|---|
| **`AboutDialog` propio + botón en el Toolbar** | Superficie conceptualmente más limpia, pero cuesta un componente, un trigger, su test de visibilidad y un octavo control en el Toolbar, para mostrar el mismo párrafo que entra al pie de un diálogo que ya existe y ya está siempre accesible. Si algún día hace falta versión/build/changelog (§4), este es el camino y el `THIRD_PARTY_CREDITS` de §2 se muda sin tocarse. |
| **Línea de crédito en el estado vacío** (`UX_Guidelines.md` §11) | Visible sin abrir nada, pero desaparece apenas hay un documento abierto — que es donde el usuario pasa casi todo su tiempo y donde el dato atribuido efectivamente se usa. |
| **Nota o tooltip en `PersonGenderSelect`** | Contextual y baratísimo, pero el crédito solo aparecería sobre grupos `Person`: quien anonimiza un documento sin personas nunca lo ve. Para una obligación de licencia es un cumplimiento condicionado al contenido del documento del usuario, que es tanto como no cumplirla. |
| **Dejarlo en `NOTICE` + `README`** | Es exactamente lo que ADR-060 §11 descarta por escrito: la app se distribuye como sitio estático y quien la usa no clona el repo. |
| **URLs como texto plano, no clicables** | Cumple la licencia (el URI está a la vista) y evita la primera navegación externa del producto. Se descarta porque obliga al usuario a copiar una URL a mano para ejercer lo que la licencia le concede, y `rel="noopener noreferrer"` cierra el riesgo real (§3). |

## Consecuencias

**Positivas**: el Hito 10.6 puede cerrarse con la obligación de CC-BY efectivamente cumplida, no diferida; el costo es un bloque estático y un módulo de datos, sin componente nuevo ni control nuevo en el Toolbar; y la forma elegida (datos separados de la vista) deja el lugar preparado para las licencias de código de Contexto §4, que van a hacer falta antes del release.

**Negativas**: la atribución queda a un clic de distancia en vez de estar siempre a la vista —es el precio de un layout sin footer, y CC-BY admite un aviso "razonable según el medio"—; el producto gana sus dos primeros enlaces externos, y con ellos la necesidad de la regla de §3 para que no se multipliquen; y "Configuración" pasa a alojar algo que no es configuración, que es el compromiso consciente de no construir un diálogo entero para un párrafo.

**Neutras**: el Core no se entera; ningún contrato de `docs/core/Contracts.md` cambia; el guardado atómico del `SettingsDialog` queda idéntico (§1); la CSP no se toca; y `PersonGenderSelect` y la marca de "sin determinar" del PR 12 quedan exactamente como están.

## Docs actualizados por este ADR

- `ui/Components.md` §1 (el archivo nuevo en la estructura) y §2.6 (la sección "Acerca de": contenido, comportamiento, ARIA, y que está fuera del guardado atómico).
- `roadmap/MVP.md` §4 — bloque del Hito 10.6: el PR 12b y los estados reales de la tabla de PRs.
- `roadmap/Future_Ideas.md` — las licencias de código del stack (Contexto §4).
- **Con el PR 12b, no antes** (§6): `NOTICE` (retirar el párrafo de pendiente), `ADR-060` §"Validación" y `ADR-069` §"Validación" (tachar el ítem de atribución visible).

## Validación

- Los tests de §5 verdes, en particular el que ata el crédito visible a `gender-lexicon.provenance.json`.
- La aserción E2E del escenario 9: con el `SettingsDialog` abierto, el crédito y el enlace a la licencia se ven.
- Verificación manual de que los dos enlaces abren en pestaña nueva y llevan al dataset y a la licencia correctos.
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract`.

## Referencias

- `adr/ADR-060` §11, §12 — `adr/ADR-069` §1, §2 — `adr/ADR-036` §7 — `adr/ADR-018`
- `ui/Components.md` §1, §2.6, §3.4b, §13 — `ui/UX_Guidelines.md` §2, §9 — `architecture/08_Security_Model.md` §3.2
- `NOTICE` — `packages/anonymization-core/grouping-engine/assets/gender-lexicon.provenance.json`
- Fuente atribuida: [Nombres — Buenos Aires Data](https://data.buenosaires.gob.ar/dataset/nombres), recurso "Nombres Permitidos", CC-BY-2.5-AR
