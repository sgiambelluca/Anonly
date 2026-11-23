<!-- CONTEXT: scope=adr | dependencias=adr/ADR-221-Los-Formatos-Base-Salen-De-Un-Catalogo-Por-Pais.md,adr/ADR-236-La-1.1.1-Trae-Veinte-Paises-Y-La-Interfaz-En-Ingles.md,roadmap/Roadmap_1.x.md,roadmap/Plan_1.1.1.md,roadmap/Plan_1.1.md | audiencia=humanos+IA | fase=roadmap-1.x -->

# ADR-237 — Los países y la interfaz en inglés quedan sin versión

- **Estado**: Aceptado por el mantenedor el 2026-11-23.
- **Fecha**: 2026-11-23.
- **Decidido por**: el mantenedor.
- **Origen**: `Roadmap_1.x.md` §4bis, §5 y §6.
- **Modifica**:
  - ADR-221 §7: los países que no son Argentina dejan de salir en la 1.1.1;
  - ADR-236 §2: la versión. El resto de ADR-236 sigue vigente;
  - ADR-236 §5: quién ve la pantalla de país del primer arranque.
- **Alcance**: solo documentación. No cambia ningún contrato ni ningún
  motor.
- **Relacionado con**: ADR-221 y ADR-236.

## Contexto

ADR-236 fijó que la próxima versión después de la 1.1.0 era la 1.1.1, con
diecinueve países nuevos y la interfaz en inglés. La tanda 1 tiene la
investigación y dos mediciones, pero su tabla final no está aprobada
(`Plan_1.1.1.md` §6). Nada está implementado en los motores.

El 2026-11-23 el mantenedor reordenó el roadmap:

- **la próxima versión es la de otros formatos de documento**, para que la
  app tome más tipos de archivo además de PDF. Pasa a ser la 1.2;
- **la de varios documentos pasa a la 1.3**, después de los formatos;
- **los países quedan sin versión**, porque el mantenedor quiere poner todo
  el esfuerzo en los formatos primero;
- **la interfaz en inglés queda con los países**, también sin versión.

## Decisión

### 1. Los países y la interfaz en inglés no tienen versión asignada

- Lo que ADR-236 ubicaba en la 1.1.1 (los diecinueve países, los cuatro
  tipos base nuevos, las variantes en inglés de Estados Unidos, la pantalla
  de país y la interfaz en inglés) **sigue decidido tal como está**, pero sin
  versión.
- **Sale todo junto**, como fija ADR-236 §2: las seis tandas y la interfaz
  en inglés.
- **El número se decide al retomarlo.** Por `Roadmap_1.x.md` §1 corresponde
  a una versión menor. La excepción de ADR-221 §7, que lo numeraba como
  parche, deja de aplicar: entre medio salen otras versiones menores.
- **El trabajo hecho se conserva.** La investigación y las mediciones de la
  tanda 1, y los prototipos de `tests/paises/`, quedan como están. Se retoma
  por `Plan_1.1.1.md` §6.

### 2. Quién ve la pantalla de país

ADR-236 §5 decía que quien actualiza desde la 1.1.0 no ve la pantalla de
país y sigue en Argentina. Como antes salen la 1.2 y la 1.3, la regla pasa a
ser: **quien actualiza desde cualquier versión anterior a la de los países**
no ve la pantalla y sigue en Argentina. La prueba del rastro de uso anterior
que pide ADR-236 §5 se hace con la última versión publicada antes de la de
los países, no con la 1.1.0.

### 3. La 1.1.1 queda libre

Desde ahora, «1.1.1» es solo el próximo parche posible de la 1.1, con el
criterio de `Roadmap_1.x.md` §1. Los nombres de archivo que dicen 1.1.1
(ADR-236 y `Plan_1.1.1.md`) no se cambian, para no romper los enlaces.

## Lo que no cambia

- El mecanismo de catálogos de ADR-221 y todo el contenido de ADR-236 fuera
  de §2 y §5.
- La 1.1 sigue con Argentina sola, con el selector de país y «agregar desde
  otro país» ocultos.
- Las tablas de cada tanda las sigue aprobando el mantenedor con su medición
  (ADR-221 §6).

## Consecuencias

**A favor**

- Todo el trabajo va a los formatos de documento.
- No queda una versión comprometida esperando un trabajo en pausa.

**En contra**

- Los textos de la interfaz se van a seguir escribiendo en español dentro de
  los componentes durante la 1.2 y la 1.3. Cuantos más textos haya, más
  trabajo lleva sacarlos al catálogo de ADR-236 §7.
- Los formatos nuevos de la 1.2 (Word, Excel, PowerPoint, imágenes) no se
  prueban con los países: cuando se retomen los países, su medición también
  tiene que cubrir esos formatos.
- Los comentarios del código que dicen «desde la 1.1.1» quedan desfasados
  hasta que se corrijan, cada uno en el commit de su módulo.

## Cómo se verifica

- `Roadmap_1.x.md` no ubica los países en ninguna versión, y la 1.2 es la de
  otros formatos.
- Ningún doc vigente de `core/` ni de `ui/` dice que los países salen en la
  1.1.1.
