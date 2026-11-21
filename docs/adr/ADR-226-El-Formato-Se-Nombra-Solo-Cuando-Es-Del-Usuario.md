<!-- CONTEXT: scope=adr | dependencias=core/Contracts.md,ui/Components.md,ui/UX_Guidelines.md,adr/ADR-092-La-Caratula-Es-Un-Patron-No-Un-Caso-De-Modelo.md,adr/ADR-220-Un-Formato-Se-Arma-Con-Piezas-Y-Se-Recorre-En-Tiempo-Lineal.md,adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-222-Dos-Formatos-Que-Se-Pisan-Van-Al-Panel-De-Conflicto.md,adr/ADR-224-Lo-Que-La-1.1-Cambia-En-El-Panel-De-Entidades-Y-El-Visor.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=1.1 -->

# ADR-226 — El formato se nombra solo cuando es del usuario

- **Estado**: Aceptado por el mantenedor el 2026-11-16. Recoge decisiones que el mantenedor
  tomó el 2026-10-20, al cerrar la pantalla de trabajo en el lienzo de diseño
  de la 1.1.
- **Fecha**: 2026-11-16.
- **Precisión del 2026-11-21** (mantenedor): qué hace el clic sobre una
  entidad del visor (§4).
- **Decidido por**: el mantenedor.
- **Origen**: el diseño de la interfaz de la 1.1 (`Plan_1.1.md` §6, frente F7).
- **Alcance**: `react-client`. **No cambia el contrato**: `EntityGroup.formatId`
  se sigue calculando como dice ADR-224 §2.
- **Modifica**: ADR-224 §2 (cuándo el árbol muestra el subnivel), §3 (el
  filtro por formato) y §4 (el renglón del formato en el tooltip, y cómo se
  activa).
- **Relacionado con**: ADR-222 (el panel de conflicto, que es la excepción).

## Contexto

ADR-224 §2 puso bajo un subnivel todo lo que sale de un formato. Al
dibujarlo aparecieron dos problemas.

**La carátula esconde a la parte principal.** Un expediente empieza con
«Fernández, María Laura c/ …», que detecta el formato «Carátula» del
catálogo (ADR-092). En el cuerpo, «María Laura Fernández» aparece varias
veces y la detecta el modelo. Son una sola entidad, y por la regla de la
primera aparición quedaba sola bajo «Formato: Carátula», separada de las
demás personas.

**Saber qué formato del catálogo detectó un dato no le sirve al usuario.**
El mantenedor lo dijo así: que un nombre se haya leído en el texto o en la
carátula «no suma nada». Lo mismo vale para un teléfono que salió de
«Celular» o de «Teléfono fijo».

**Sí le sirve ver qué atrapó un formato suyo**: es la forma de revisar si
lo que armó en el generador funciona.

## Decisión

### 1. Qué es un formato «tuyo»

Un formato es del usuario si es alguno de estos:

- un formato propio, armado con el generador (ADR-220);
- una copia editada de un formato base (ADR-220 §4);
- desde la 1.1.1, un formato agregado desde otro país (ADR-221 §5).

Los formatos base del país activo no son del usuario, estén prendidos o
apagados.

La interfaz lo resuelve con lo que ya tiene: el `formatId` del grupo está o
no en `detection.userFormats` o en `detection.catalogRefs` (ADR-223 §2).

### 2. El árbol: subnivel solo para formatos tuyos

Dentro de un tipo:

- **van directo bajo el tipo** los grupos sin `formatId` (modelo y
  agregados a mano) **y los grupos cuyo formato es del catálogo**;
- **van en un subnivel**, con el nombre del formato, los grupos cuyo formato
  es del usuario.

**El subnivel aparece solo si separa algo.** Un tipo cuyo contenido sale
todo de un único formato del usuario no lo muestra.

| Tipo | Qué tiene | ¿Subnivel? |
|---|---|---|
| Persona | Nombres del modelo y uno que también salió de la carátula | No |
| DNI | Dos DNI del formato «DNI» del catálogo | No |
| Teléfono | Uno de «Celular», uno agregado a mano y uno de tu «Celular de Chile» | Sí, solo para «Celular de Chile» |
| CBU (tipo tuyo) | Todo sale de tu único formato «CBU» | No |
| Historia clínica (tipo tuyo) | Entidades de tus dos formatos | Sí, uno por formato |

Los grupos sin subnivel van primero. Dentro de cada nivel, el orden es el
de siempre (aparición o A–Z).

### 3. El filtro: «Tus formatos»

- El filtro por formato de ADR-224 §3 lista **solo los formatos del
  usuario** que detectaron algo en el documento.
- Se llama «Tus formatos».
- **Si no hay ninguno, la sección no aparece.**

Los otros tres filtros de ADR-224 §3 no cambian en qué muestran. Cómo se
ven lo define el ADR de la pantalla de trabajo (ADR-229).

### 4. El tooltip del visor

**Qué muestra.** Lo de ADR-224 §4, con un cambio: el renglón «Formato»
aparece **solo si el formato es del usuario**.

**Cuándo aparece** (ADR-224 §4 lo dejaba al diseño):

- al dejar el mouse quieto unos 400 ms sobre una entidad;
- en la vista Original, sobre el texto resaltado;
- en la vista Anonimizado, sobre el reemplazo: la etiqueta, la máscara o el
  bloque negro;
- también sobre una entidad desactivada. En «Reemplazo» dice «Desactivada:
  queda a la vista».

**Cuándo se va o no aparece:**

- al sacar el mouse o apretar `Esc`;
- al hacer clic. Un clic sin arrastrar sobre una entidad **activa** (que se
  reemplaza) la selecciona en el panel de entidades: la lista va a su fila y
  la resalta. Sobre una entidad desactivada el clic solo cierra el tooltip.
  Arrastrar sigue seleccionando texto, como en la 1.0. Precisión del
  mantenedor, 2026-11-21: hasta la 1.1 el visor no seleccionaba entidades con
  un clic;
- mientras se arrastra para seleccionar texto, mientras se hace zoom, o con
  un menú o un diálogo abierto.

**No se ata al foco del teclado.** Las entidades del visor no reciben foco.
Quien recorre la lista con el teclado ya ve en la fila el tipo, el valor, el
modo y las apariciones, y el formato en el subnivel.

### 5. La excepción: el panel de conflicto

Cuando dos formatos reconocen el mismo texto (ADR-222), el panel nombra los
dos y dice de dónde sale cada uno: «tu formato «Cliente»» y «el formato
«CUIT/CUIL» del catálogo». Ahí el usuario elige entre ellos y necesita
saber cuál es cuál.

## Lo que no cambia

- `EntityGroup.formatId`, quién lo calcula y cuándo queda ausente (ADR-224
  §2). `grouping-engine` no cambia por este ADR.
- Los filtros por modo, por desactivadas o con conflicto y por agregadas o
  editadas a mano; cómo se combinan y cuánto duran (ADR-224 §3).
- El contenido del tooltip salvo el renglón del formato.

## Consecuencias

- La parte principal de un caso vuelve a estar con las demás personas.
- El panel muestra menos niveles: el subnivel queda para lo que el usuario
  quiere revisar.
- Una sola regla en toda la pantalla, con una excepción explícita.
- **El usuario ya no puede filtrar por un formato del catálogo.** Si hiciera
  falta, se reabre con evidencia de uso.

## Cómo se verifica

- Un grupo cuyo `formatId` es de un formato base aparece directo bajo su
  tipo, sin subnivel.
- Un grupo cuyo `formatId` es de un formato propio aparece en un subnivel
  con el nombre del formato, si el tipo tiene además otros grupos u otro
  formato del usuario.
- Un tipo propio con un solo formato no muestra subnivel.
- El filtro «Tus formatos» no lista formatos base, y no aparece en un
  documento donde ningún formato del usuario detectó algo.
- El tooltip de una entidad detectada por un formato base no tiene renglón
  «Formato»; el de una detectada por un formato propio, sí.
- El tooltip no aparece durante un arrastre de selección ni con un diálogo
  abierto.

## Documentación que cambia

- `Components.md`: `EntitiesPanel`, `EntityTypeGroup` y el tooltip del
  visor.
- `UX_Guidelines.md`: la regla y su excepción.
- ADR-224: nota de «modificado por ADR-226» en §2, §3 y §4.
