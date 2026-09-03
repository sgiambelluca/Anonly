# @anonly/react-client

Cliente web de Anonly (React + Vite + Tailwind + Radix UI + Zustand).

> SPA que consume `@anonly/anonymization-core`. **Toda la lógica de
> anonimización vive en el Core**: esta app importa su API pública, se suscribe
> a su bus de eventos y dibuja. No procesa documentos.

Para instalar y correr el monorepo (incluido `pnpm assets:mirror`, sin el cual
la app arranca pero no detecta nombres ni lee escaneados), ver el
[README de la raíz](../../README.md#empezar).

## Documentación

- UI Contract: [`docs/ui/React_Client.md`](../../docs/ui/React_Client.md)
- UX Guidelines: [`docs/ui/UX_Guidelines.md`](../../docs/ui/UX_Guidelines.md)
- Componentes: [`docs/ui/Components.md`](../../docs/ui/Components.md)

## Los tres momentos (ADR-087)

La app no tiene un layout fijo de paneles: tiene **tres momentos**, y cada uno
muestra solo lo que sirve en ese momento.

```
① Cargar            ② Escanear                ③ Revisar
┌──────────────┐    ┌──────────────────┐    ┌──────────┬───────────────┐
│              │    │                  │    │ Toolbar  │               │
│  arrastrá    │ →  │  progreso +      │ →  ├──────────┴───────────────┤
│  un PDF acá  │    │  entidades que   │    │ Entidades │  Visor       │
│              │    │  van apareciendo │    │ (árbol)   │  Original ⇄  │
│      ⚙       │    │                  │    │           │  Anonimizado │
└──────────────┘    └──────────────────┘    └───────────┴──────────────┘
 LoadScreen          ScanScreen               WorkLayout
```

- **①** monta `LoadScreen` a pantalla completa, con drag & drop funcional y el
  botón de Configuración (ADR-125: es lo único de la toolbar que tiene sentido
  sin documento — ahí se elige con qué se va a analizar el PDF).
- **②** monta `ScanScreen`, también a pantalla completa. Sin toolbar: el estado
  y el progreso ya están en la pantalla.
- **③** monta la toolbar, el árbol de entidades y **un solo visor** que alterna
  entre `Original` y `Anonimizado`. El lado a lado y el panel de Reglas se
  retiraron en ADR-087: el nivel "tipo" vive ahora en la cabecera de cada
  categoría del árbol, y el nivel "documento" en su propia franja.

## Estructura

```
src/
├── components/
│   ├── screens/      # LoadScreen, ScanScreen, TooNarrowScreen
│   ├── toolbar/      # estado del pipeline, settings, export
│   ├── entities/     # árbol de grupos, fusionar/dividir, modos
│   ├── viewer/       # visor, zoom, búsqueda, selección
│   ├── conflicts/    # resolución entre detectores
│   ├── export/       # diálogo de export
│   └── common/       # Button, Dialog, Select, Checkbox, Banner…
├── core-adapter/     # la única frontera con el Core (ver abajo)
├── store/            # Zustand, un slice por dominio
└── polyfills.ts      # Safari 17: Promise.withResolvers para pdfjs
```

### `core-adapter/` — la frontera

| Archivo | Qué hace |
|---|---|
| `index.ts` | Crea el Core (`initCore`), lo libera (`disposeCore`) y lo recrea con config nueva (`recreateCore`, ADR-125). Inyecta las factories de los cinco workers. |
| `bus-bridge.ts` | Suscribe los stores a los eventos del Core. Es el **único** camino Core → UI. |
| `actions.ts` | Las acciones que la UI emite al Core (importar, editar grupo, fusionar, reanalizar, exportar). Único camino UI → Core. |
| `settingsToEngineConfig.ts` | Traduce los settings del usuario a `EngineConfigOverrides` (`React_Client.md` §3.7). |

### Stores (Zustand, `src/store/`)

`document`, `entities`, `rules`, `pipeline`, `viewer`, `settings` y `degraded`.
Cada uno implementa la forma que fija `docs/ui/React_Client.md` §3 y se alimenta
**solo** desde `bus-bridge.ts`. Sin dependencias entre stores.

## Stack

- **React 18** + TypeScript estricto
- **Vite 6** como bundler
- **Tailwind CSS 3** (tokens de `docs/ui/Components.md` §10)
- **Radix UI** para primitives accesibles (Dialog, Select, Checkbox, Tooltip)
- **Zustand 5** para estado de UI
- **lucide-react** para iconos

## Scripts

```bash
pnpm dev          # Vite dev server (http://localhost:5173)
pnpm build        # tsc -b && vite build
pnpm preview      # sirve el build localmente
pnpm typecheck    # tsc --noEmit
pnpm test         # tests de este paquete (vitest, entorno node)
```

`predev` y `prebuild` copian los assets de `pdfjs-dist` (`cmaps/`,
`standard_fonts/`) a `public/pdfjs/`. Salen de `pnpm-lock.yaml`, no de
`assets.lock.json`: son parte de una dependencia, no un modelo mirroreado.

El dev server usa **`strictPort`**: si el 5173 está ocupado falla en vez de
correrse al puerto de al lado. Dos dev servers a la vez comparten el caché de
Vite en disco y lo envenenan de una forma que sobrevive a reiniciar la máquina
(ver el comentario en `vite.config.ts`).

## Reglas (`docs/ai/Code_Standards.md` §12)

- El cliente puede importar React y librerías de UI.
- El cliente **nunca** importa internos de motores, solo `@anonly/anonymization-core` (API pública).
- El cliente **nunca** contiene lógica de anonimización; toda va al Core.
- Comunicación con el Core: únicamente por el `IEventBus` y la API pública.

## CSP y aislamiento

`index.html` declara la CSP (ver `docs/architecture/08_Security_Model.md` §3.2):

- `default-src 'self'`, `connect-src 'self'` — **sin third-party en runtime**.
- `script-src 'self' blob: 'wasm-unsafe-eval'` y `worker-src 'self' blob:` — el
  `wasm-unsafe-eval` lo exigen ONNX Runtime y Tesseract para instanciar sus
  módulos wasm; `blob:` lo exigen los workers que las librerías crean por su
  cuenta. Sigue **sin** `unsafe-eval`.
- `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `unsafe-inline` en `style-src` lo requiere Tailwind en dev; se elimina en v1.0
  con el build que extrae el CSS a archivo.

`public/_headers` declara además **COOP/COEP** (ADR-100): sin aislamiento de
origen cruzado el navegador no expone `SharedArrayBuffer` y la inferencia de NER
corre en un solo hilo, al doble de tiempo. El dev server manda los mismos dos
headers para que desarrollo y producción se comporten igual.
