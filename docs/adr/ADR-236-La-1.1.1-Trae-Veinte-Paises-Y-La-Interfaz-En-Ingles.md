<!-- CONTEXT: scope=adr | dependencias=adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-057-Escalera-Abreviaturas-Placeholder-Por-Grupo.md,adr/ADR-132-El-Shell-Tiene-Su-Propio-Modelo-De-Seguridad.md,adr/ADR-194-Automatico-Elige-El-Perfil-De-Rendimiento-Segun-El-Equipo.md,adr/ADR-219-Un-Tipo-De-Entidad-Puede-Ser-Del-Usuario.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-223-Los-Formatos-Se-Configuran-Desde-Inicio-Y-Viajan-En-Un-Archivo.md,core/Contracts.md,core/Regex_Engine.md,core/OCR_Engine.md,ui/React_Client.md,ui/UX_Guidelines.md,roadmap/Roadmap_1.x.md,roadmap/Plan_1.1.1.md | audiencia=humanos+IA | fase=1.1.1 -->

# ADR-236 — La 1.1.1 trae veinte países y la interfaz en inglés

- **Estado**: Aceptado por el mantenedor el 2026-11-22, con los detalles
  técnicos del planificador. **Enmendado por ADR-237** (2026-11-23): todo
  lo que este ADR ubica en la 1.1.1 queda sin versión, y la interfaz en
  inglés sigue con los países. Cambian la versión (§2) y quién ve la
  pantalla de país (§5). El resto sigue vigente.
- **Fecha**: 2026-11-22.
- **Decidido por**: el mantenedor, a propuesta del planificador.
- **Origen**: `Roadmap_1.x.md` §4bis y [`Plan_1.1.1.md`](../roadmap/Plan_1.1.1.md).
- **Modifica**:
  - ADR-221 §1, §2, §6 y §7. El mecanismo de ADR-221 no cambia;
  - `Roadmap_1.x.md` §10: la interfaz en inglés deja de ser el último paso.
- **Alcance**:
  - contrato (`Contracts.md`: `CountryCode` y `EntityType`);
  - `regex-engine`, `grouping-engine` y el sintetizador de `@anonly/shared`.
    Si la hoja de referencia necesita algo por los tipos nuevos, también
    `render-engine` o `export-engine`: lo confirma el spec;
  - `react-client` y `desktop-shell`.
  - Una dependencia de traducción, si hiciera falta, lleva su propio ADR
    (§7).
- **Relacionado con**: ADR-057, ADR-132, ADR-194, ADR-219, ADR-222 y ADR-223.

## Contexto

ADR-221 fijó un catálogo por país y tres países: Argentina en la 1.1, y Chile
y Uruguay en la 1.1.1. La 1.1.0 salió con Argentina sola, y el selector de
país y «agregar desde otro país» ocultos.

El 2026-11-22 el mantenedor amplió la 1.1.1:

- entran **todos los países hispanohablantes de Latinoamérica, España y
  Estados Unidos**;
- sale **una sola 1.1.1**, y las tablas de cada país se aprueban **por
  tandas**;
- entran **cuatro tipos base nuevos** para datos críticos que unos países
  tienen y otros no: seguridad social, pasaporte, licencia de conducir y
  cuenta bancaria. En Argentina, la cuenta bancaria es el CBU y el CVU;
- **Estados Unidos trae fechas, direcciones y carátula en inglés.** Quien
  trabaja en español no ve ningún cambio de detección. Quien quiera las
  variantes en inglés con otro país activo las suma igual;
- **la interfaz en inglés** entra en la 1.1.1;
- **se numera 1.1.1**, como decía ADR-221 §7;
- **la app pregunta el país la primera vez que se abre**, con el país del
  sistema preseleccionado. Quien actualiza desde la 1.1.0 sigue en Argentina
  sin que se le pregunte.

El OCR ya lee inglés: carga `spa+eng` por defecto (`OCR_Engine.md`), y el
modelo de inglés ya viene en el instalador. El modelo de NER es
multilingüe. Lo que asume el español son cuatro formatos universales: las dos
fechas, la dirección con palabra clave y la carátula.

## Decisión

### 1. Los países

Además de Argentina, diecinueve países, con su código ISO 3166-1 alfa-2:

| Código | País | Código | País |
|---|---|---|---|
| `BO` | Bolivia | `HN` | Honduras |
| `CL` | Chile | `MX` | México |
| `CO` | Colombia | `NI` | Nicaragua |
| `CR` | Costa Rica | `PA` | Panamá |
| `CU` | Cuba | `PE` | Perú |
| `DO` | República Dominicana | `PY` | Paraguay |
| `EC` | Ecuador | `SV` | El Salvador |
| `ES` | España | `US` | Estados Unidos |
| `GT` | Guatemala | `UY` | Uruguay |
| | | `VE` | Venezuela |

```ts
// Contracts.md §5, al cerrar la 1.1.1
export type CountryCode =
  | "AR" | "BO" | "CL" | "CO" | "CR" | "CU" | "DO" | "EC" | "ES" | "GT"
  | "HN" | "MX" | "NI" | "PA" | "PE" | "PY" | "SV" | "US" | "UY" | "VE";
```

- **La regla de ADR-221 §1 sigue**: un código entra al tipo en el mismo
  cambio que su catálogo, sus etiquetas y sus generadores. Ninguna
  configuración puede elegir un país sin catálogo, tampoco en la branch de la
  1.1.1 entre una tanda y la siguiente.
- Los ids de formato llevan el código en minúscula adelante, como fijó
  ADR-221 §2: `cl:…`, `us:…`. Los de Argentina no cambian.
- **Estados Unidos tiene formatos que cambian por estado**, como la
  licencia de conducir y la patente. La tabla de su tanda propone cuáles
  entran y cómo; el catálogo sigue siendo uno solo para el país.

### 2. Una sola 1.1.1, aprobada por tandas

El trabajo de ADR-221 §6 (investigación, corpus sintético, medición y tablas)
se hace por tandas:

| Tanda | Países |
|---|---|
| 1 | Chile, Uruguay, Paraguay y Bolivia, más los tipos nuevos de Argentina (§3) |
| 2 | Perú, Ecuador, Colombia y Venezuela |
| 3 | México, Guatemala, El Salvador, Honduras y Nicaragua |
| 4 | Costa Rica, Panamá, Cuba y República Dominicana |
| 5 | España |
| 6 | Estados Unidos, con sus variantes en inglés (§4) |

- **El mantenedor aprueba las tablas de cada tanda** antes de que el
  planificador las escriba en los specs, como fija ADR-221 §6.
- La tanda siguiente puede investigarse mientras se implementa la anterior.
- **La 1.1.1 sale cuando están las seis y la interfaz en inglés.** Se numera
  como parche por la excepción de ADR-221 §7, que se mantiene.

### 3. Cuatro tipos base nuevos

```ts
// Contracts.md §5: se suman a EntityType
SocialSecurity = "SOCIAL_SECURITY", // seguridad social
Passport = "PASSPORT",              // pasaporte
DriverLicense = "DRIVER_LICENSE",   // licencia de conducir
BankAccount = "BANK_ACCOUNT",       // cuenta bancaria nacional
```

- **Son tipos base**, como `DNI` o `Plate`: dependen del país, tienen
  nombre y escalera de etiquetas por país (ADR-221 §3) y generador
  sintético. Por ADR-221 §3, un tipo sin formatos en el país activo no
  aparece en los selectores.
- **`DriverLicense` no es `License`.** `License` sigue siendo la matrícula
  profesional.
- **`BankAccount` no es `IBAN`.** `IBAN` sigue siendo un tipo universal, con
  su nombre fijo. `BankAccount` es la cuenta con la forma de cada país: el
  CBU y el CVU en Argentina, la CLABE en México, y lo que encuentre cada
  tanda.
- **Argentina entra en la tanda 1 solo para estos cuatro tipos.** Su cuenta
  bancaria ya está decidida: **el CBU y el CVU**, que tienen la misma forma
  (22 dígitos, con los dos dígitos verificadores del BCRA). Es un solo
  formato `control`, bajo un nombre que sirva para los dos. La tabla de la
  tanda 1 propone ese nombre, su escalera de etiquetas, su máscara y su
  generador, y qué formatos argentinos tienen los otros tres tipos.
- Lo que Argentina suma no cambia lo de hoy: la línea de base de calidad
  sigue en 78 de 78 y sin pérdidas, y las notas de la 1.1.1 dicen que cambia
  la detección con Argentina.
- **Un identificador que no entra en ninguno de los nueve tipos que dependen
  del país** no va al catálogo. El informe de su tanda lo lista con el
  nombre que tiene en su país. El usuario lo puede crear como formato
  propio, bajo un tipo propio (ADR-219).
- **Un país puede tener varios formatos bajo un mismo tipo base.** El tipo
  tiene un solo nombre por país (ADR-221 §3), y ese nombre tiene que servir
  para todos sus formatos. La tabla de la tanda lo propone.
- Es un cambio de contrato: va en su propio commit, con este ADR (R-2).

### 4. Los formatos universales, en español salvo con Estados Unidos

**Con los diecinueve países hispanohablantes, los universales son los de
hoy.** Quien trabaja en español no ve ningún cambio. La medición de cada
tanda dice cómo se comportan con textos del país:

- si un universal falla con un país, es un hallazgo que va al informe de la
  tanda y al mantenedor. No se ajusta en silencio, ni para el país ni para
  Argentina;
- un universal que cambie para un país hispanohablante pide otro ADR.

**Estados Unidos trae variantes en inglés** de cuatro universales, en su
propio catálogo (`us:…`):

- la fecha numérica en orden mes, día y año;
- la fecha en texto, con los meses en inglés;
- la dirección con palabra clave, con las palabras de vía en inglés;
- la carátula, con un léxico de nombres en inglés.

Reglas:

- **Con Estados Unidos activo, la fecha numérica de mes y día reemplaza a la
  de día y mes.** «03/04/2025» no se puede leer de las dos formas a la vez.
  El catálogo puede reemplazar un universal: es el único que lo hace.
- **Qué universales en español siguen corriendo con Estados Unidos**, para
  sus documentos en español, lo propone la tabla de la tanda 6.
- **Con otro país activo, las variantes en inglés se suman** con «agregar
  desde otro país» (ADR-221 §5), de a una. La 1.1.1 suma además una acción
  que agrega las cuatro de una vez. Su diseño pasa por el mantenedor.
- **Una fecha en mes y día agregada con otro país activo convive con la de
  día y mes.** Sobre «03/04/2025» las dos matchean el mismo tramo con el
  mismo tipo. Por `Regex_Engine.md` caso 46 («mismo tipo, mismo largo») hoy
  sale un solo match, el propio. Falta fijar si una referencia de ADR-221
  §5 cuenta como propia ahí, y si no manda nada al panel de conflicto
  (ADR-222). El spec de la tanda 6 lo fija con un caso.

### 5. La app pregunta el país al primer arranque

- **Una pantalla de país aparece la primera vez que se abre la app**, igual
  en Windows y en macOS. No hay paso en el instalador: en macOS no lo hay.
- **La shell lee la región del sistema operativo**, con la API nativa y sin
  red (en Electron, `app.getLocaleCountryCode()`). La expone al renderer en
  `window.anonlyDevice`, junto a las señales de ADR-194, como un código de
  dos letras o nada.
- **Qué queda preseleccionado:**
  - la región del sistema, si es uno de los veinte países;
  - Argentina, si es otro país, si la shell no da región o si la app corre
    fuera de la shell.
- **Elegir es guardar `country`** en la configuración de detección
  (`React_Client.md` §3.8), como un `commit()` sin diálogo. El Core arranca
  con ese país.
- **Después se cambia desde «Formatos de detección»**, con el selector de
  país que la 1.1.1 deja de ocultar (ADR-221 §7, `Components.md` §13b).
- **Quien actualiza desde la 1.1.0 no ve la pantalla** y sigue en
  Argentina, como dice ADR-221 §1.
  - Un perfil con configuración de detección guardada ya se distingue.
  - **Un perfil de la 1.1.0 sin nada guardado** no deja una clave
    `anonly:*` en `localStorage`. Antes de escribir el spec, el planificador
    prueba qué rastro de uso anterior se puede leer sin red, con una 1.1.0
    instalada, en Windows y en macOS. Lo que salga se fija en el spec de la
    shell. Si no hay ningún rastro confiable, vuelve al mantenedor.
- **El diseño de la pantalla** pasa por el mantenedor antes del spec, con
  capturas en claro y en oscuro.

### 6. El país y el idioma de la interfaz no dependen uno del otro

- **Cambiar el idioma de la interfaz no cambia la detección.** Elegir
  Estados Unidos no pone la interfaz en inglés, y elegir inglés no pone
  Estados Unidos.
- Las etiquetas de los marcadores (`[DNI 01]`, `[RUT 01]`) salen del país
  activo, no del idioma de la interfaz (ADR-221 §3).

### 7. La interfaz en inglés

- **Toda la interfaz se puede mostrar en inglés**: pantallas, diálogos,
  avisos, textos de falla y ayuda de atajos. El selector de idioma de
  Configuración deja de estar oculto (`Roadmap_1.x.md` §10).
- **Hoy la app no tiene infraestructura de traducción.** Los textos están
  escritos en español en los componentes. El primer paso es sacarlos a un
  catálogo de textos por idioma, sin cambiar ninguno en español.
- **Cómo se arma ese catálogo:** el planificador propone primero un módulo
  propio, sin dependencias. Si hiciera falta una librería, lleva su ADR
  (R-12).
- **El mantenedor aprueba los textos en inglés**, como aprobó los de
  `UX_Guidelines.md` §11b.16.
- **El español sigue siendo el idioma por defecto.**

## Lo que no cambia

- El mecanismo de ADR-221: un país activo, las etiquetas y los generadores
  de ese país, los ajustes por país y «agregar desde otro país».
- **La detección de quien trabaja en español**: con un país hispanohablante,
  los universales son los de hoy (§4).
- **El catálogo argentino** de la 1.1.0 y la línea de base de calidad, hoy
  78 de 78, con Argentina y sin formatos propios. Los tipos nuevos pueden
  sumar formatos argentinos, nunca quitar ni cambiar los de hoy (§3).
- Los documentos de Argentina conservan su valor sintético (ADR-221 §4).
- **Los textos en español** de la interfaz.
- El OCR: ya lee español e inglés.
- Nada sale a la red: la región sale del sistema operativo.

## Consecuencias

**A favor**

- Un usuario de cualquiera de los veinte países recibe los formatos, las
  etiquetas y los sintéticos de su país.
- Los datos más críticos (seguridad social, pasaporte, licencia de conducir
  y cuenta bancaria) se detectan donde existen. En Argentina, el CBU y el
  CVU.
- Un documento en inglés se puede anonimizar con fechas y direcciones en
  inglés, sin cambiarle la detección a quien trabaja en español.
- La primera vez, la app arranca en el país correcto sin que el usuario
  busque dónde se configura.

**En contra**

- **Diecinueve catálogos y cuatro tipos nuevos**, con su investigación, su
  corpus, su medición y sus generadores. Más la interfaz entera en dos
  idiomas. La 1.1.1 tarda bastante más en salir.
- **Cuatro valores nuevos en `EntityType`**: tocan las etiquetas de todos los
  países, la hoja de referencia y la interfaz.
- **No hay documentos reales de ninguno de los diecinueve países.** Cada
  informe dice qué sale solo de sintéticos.
- Un parche con un cambio de detección grande. Las notas de la 1.1.1 lo
  dicen.
- La superficie de la shell hacia el renderer suma un dato.
- Cada texto nuevo de la interfaz se escribe en los dos idiomas.

## Cómo se verifica

- Lo de ADR-221 «Cómo se verifica», para cada país.
- Con `"AR"` y sin formatos propios, la línea de base de calidad sigue en 78
  de 78 y los sintéticos de hoy no cambian. Un CBU sintético con dígitos
  verificadores válidos se detecta como cuenta bancaria.
- Con cualquier país hispanohablante, los universales detectan lo mismo que
  en la 1.1.0 sobre el mismo texto.
- Con `"US"`, «12/25/2025» se detecta como fecha, y con `"AR"` sin
  referencias, no.
- En un perfil nuevo, la pantalla aparece una vez, con la región del sistema
  preseleccionada si es uno de los veinte y con Argentina si no.
- Al actualizar un perfil de la 1.1.0 la pantalla no aparece, y el país es
  Argentina.
- `CountryCode` nunca tiene un código sin catálogo.
- Con la interfaz en inglés, ningún texto visible queda en español, y la
  detección es la misma que con la interfaz en español.
