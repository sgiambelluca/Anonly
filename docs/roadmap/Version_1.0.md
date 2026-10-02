<!-- CONTEXT: scope=roadmap-v1 | dependencias=roadmap/Roadmap_1.x.md,roadmap/MVP.md,00_Project_Vision.md,architecture/07_Performance_Strategy.md,architecture/08_Security_Model.md,adr/ADR-130-El-Contenedor-De-Escritorio-Fija-El-Motor.md,adr/ADR-190-Una-Pagina-Con-Tinta-No-Sale-Vacia-En-Silencio.md,adr/ADR-192-El-Pico-Total-De-Memoria-Tiene-Un-Techo-Medido-Por-Perfil.md,adr/ADR-194-Automatico-Elige-El-Perfil-De-Rendimiento-Segun-El-Equipo.md,adr/ADR-196-Las-Licencias-Del-Software-De-Terceros-Viajan-Con-El-Instalador.md | audiencia=humanos+IA | fase=12 -->

# Anonly — Versión 1.0

> **Reescrito el 2026-10-02.** La versión anterior de este documento definía
> la 1.0 como una lista de funciones a construir sobre el MVP. El humano
> decidió que **el estado actual de `main` es la 1.0**, y que todo lo
> pendiente se desarrolla en versiones 1.x (`Roadmap_1.x.md`). Este documento
> describe qué es la 1.0. La lista anterior quedó repartida: lo ya hecho
> figura en §1, lo que sigue está en `Roadmap_1.x.md`, y lo que se descartó
> está en §5.

**Versión**: 1.0.0. Es la primera versión estable. Las anteriores (0.9.x)
fueron pre-releases.

## 1. Qué trae

- **Entrada**: PDF con texto y PDF escaneado. El escaneado se lee con OCR
  local, que detecta la orientación de la página y avisa cuando una página
  con tinta no se pudo leer (ADR-190).
- **Detección**: patrones para datos argentinos (DNI, CUIT/CUIL, teléfono,
  email, IBAN, tarjeta, fecha, matrícula, patente, carátula) y un modelo
  local para personas, organizaciones, direcciones y fechas escritas.
- **Agrupación**: todas las apariciones de un mismo dato son una sola
  entidad. Fusión, división y resolución de conflictos.
- **Reemplazo**: cuatro modos (marcador, valor sintético, máscara y tachado),
  elegibles por documento, por tipo y por entidad. Marcadores por género,
  abreviados cuando no entran, y repintado del renglón.
- **Corrección a mano**: agregar una entidad escribiéndola o seleccionándola
  sobre el documento, cambiarle el tipo, editar su reemplazo, eliminarla, y
  deshacer y rehacer.
- **Revisión**: un visor con el conmutador `Original | Anonimizado`, buscador,
  zoom, y tema claro y oscuro.
- **Export**: un PDF nuevo, hecho de imágenes, sin el texto ni los metadatos
  del original. Hoja de referencia de marcadores opcional.
- **Rendimiento**: cinco perfiles; Automático elige según el equipo
  (ADR-194).
- **Distribución**: instaladores de Windows y de macOS (universal) por GitHub
  Releases, con actualización automática verificada con clave propia, que se
  puede apagar.
- **Local**: el documento no sale de la computadora. La única conexión es la
  búsqueda de actualizaciones.

Equipo mínimo: 8 GB de RAM (ADR-192).

## 2. Mediciones

Sobre `685c69b` (el `main` del 2026-10-01), en Windows nativo, con la
aplicación empaquetada. Suite corrida el 2026-10-02.

| Qué | Resultado | Límite |
|---|---|---|
| PDF de 10 páginas con texto, de la importación a `Ready` | 1967 ms | 8000 ms |
| PDF de 10 páginas escaneado | 5970 ms | 60000 ms |
| E2E | 44 pasan, 0 fallan, 1 salteado (`t5-orientation-pixel`, marcado `skip`) | — |
| Fugas (`test:leak`) | 3 de 3 | — |
| Estrés (`test:stress`) | 3 de 3 | — |
| Pico total de memoria, P1 (medido el 2026-10-01 sobre `ebd030d`) | 1596,8 MB | 2,0 GB |
| Pico total de memoria, P2 (ídem) | 2894,2 MB | 3,0 GB |

El margen de P2 es de 106 MB, menor que el ruido de esa medición (~345 MB,
ADR-146 §7): una corrida futura puede dar «no cumple» sin que nada haya
cambiado.

Los tiempos dependen del equipo y del perfil. Las suites de medición fijan el
perfil Intermedio (ADR-194 §8).

## 3. Verificación previa al tag

| Qué | Estado |
|---|---|
| Suite pesada sobre el `HEAD` final, en Windows | hecha el 2026-10-02 (§2) |
| La RAM del equipo llega a la aplicación en Windows (`window.anonlyDevice`) | verificado por el humano el 2026-10-02: Automático resuelve Ultra en su equipo |
| Un PDF protegido pide la contraseña después de recrear el Core | verificado el 2026-10-02 sobre el binario empaquetado de Windows (`win-unpacked`), cambiando el perfil antes de cargar `protected.pdf` |
| ADR-188/195: con «No buscar», la aplicación no se conecta al abrir | verificado el 2026-10-02 sobre el mismo binario, leyendo el registro de red de Chromium: por defecto consulta a `github.com`; con «No buscar» no hay ninguna conexión; «Buscar actualizaciones ahora» sí consulta |
| Lo mismo en macOS | **sin verificar** |
| Corrida de prueba de `release.yml` por `workflow_dispatch` | hecha el 2026-10-02 sobre `c8f1ea2` (`main`, con CI completa en verde): validación, instalador de macOS e instalador de Windows en verde, con sus firmas y el smoke test; el job de publicación no corre en una ejecución manual |
| Créditos de licencias del software distribuido (ADR-196) | hecho, en `main` desde el 2026-10-02 |

Las dos comprobaciones sobre el binario se hicieron con un script que maneja
la aplicación empaquetada por el puerto de depuración. No se hicieron sobre
la aplicación ya instalada con el instalador NSIS.

## 4. Limitaciones conocidas

Van en las notas de la versión. Cada una tiene su lugar en `Roadmap_1.x.md`.

- **Página escasa y girada.** En una página escaneada con muy poco texto, la
  orientación se puede detectar mal y leerse basura con confianza alta: esa
  página se exporta sin tapar y sin aviso. No apareció en el corpus medido.
  Riesgo aceptado (ADR-190).
- **Emails en escaneos de baja resolución.** Leyendo a menos de 300 dpi se
  pierden emails. Un escaneo de unos 200 dpi se lee a esa resolución
  (ADR-163). Causa sin investigar.
- **Direcciones.** En la línea de base de calidad, las cuatro direcciones del
  conjunto de referencia no se detectan.
- **Nombres en formas poco comunes.** El modelo puede no reconocer un nombre
  en mayúsculas o con el apellido primero. La red de contención es el
  agregado manual.
- **El número de expediente judicial** no tiene patrón.
- **Nada verifica de forma automática el PDF exportado.** El gate que lo lee
  con OCR (ADR-148) está decidido y sin implementar.
- **Primera instalación en Windows**: sin firma Authenticode, Windows muestra
  SmartScreen y un editor no verificado. La postulación a SignPath está
  preparada y sin enviar.
- **macOS**: la aplicación no está notarizada. Gatekeeper la bloquea la
  primera vez. Riesgo aceptado (`08_Security_Model.md` §2.3).
- **Memoria**: 8 GB como mínimo. El techo del perfil Bajo es provisorio.
- **Accesibilidad**: sin auditar. El árbol de entidades tiene varios puntos
  de tabulación por fila.
- **Idioma**: la interfaz está solo en español.

## 5. Lo que estaba previsto para la 1.0 y no se hace

| Ítem | Decisión (humano, 2026-10-02) |
|---|---|
| PWA y modo offline | fuera de alcance desde ADR-130: el instalador lo reemplaza |
| Export a imágenes PNG | descartado |
| Marca de agua «Anonimizado por Anonly» | descartada |
| Recall y precisión de NER como gate de release | no se exige para la 1.0; va en la 1.2 (`Roadmap_1.x.md` §5) |

## 6. Cómo se publica

`RELEASING.md`. El paso de `0.9.2` a `1.0.0` se hizo con un changeset de tipo
`major` en la branch `release/1.0.0`.

Quien instaló la 0.9.2 recibe la 1.0.0 desde la aplicación, sin reinstalar:
ver `Roadmap_1.x.md` §2. La 1.0.0 se publicó el 2026-10-02.

## 7. Referencias

- `roadmap/Roadmap_1.x.md`: qué sigue.
- `roadmap/MVP.md`: cómo se llegó hasta acá. Registro histórico.
- `roadmap/Version_2.0.md` y `roadmap/Future_Ideas.md`.
