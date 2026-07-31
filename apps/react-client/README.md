# @anonly/react-client

Cliente web de Anonly (React + Vite + Tailwind + Radix UI + Zustand).

> App SPA que consume el `@anonly/anonymization-core`. Esqueleto con el layout
> de 4 paneles y estados vacíos (Hito 1), ampliado en Hito 10 PR1 ("Scaffold")
> con los stores de Zustand (`src/store/`, placeholders sin conexión al bus) y
> el Hero de bienvenida (`docs/ui/UX_Guidelines.md` §11). Este PR **bootea sin
> Core**: no hay `core-adapter` ni conexión al bus todavía — eso llega en el
> PR5 del hito (`docs/roadmap/MVP.md`, Hito 10). Los componentes de negocio del
> catálogo (`docs/ui/Components.md`) se implementan en los PRs 6-9.

## Documentación

- UI Contract: [`docs/ui/React_Client.md`](../../docs/ui/React_Client.md)
- UX Guidelines: [`docs/ui/UX_Guidelines.md`](../../docs/ui/UX_Guidelines.md)
- Componentes: [`docs/ui/Components.md`](../../docs/ui/Components.md)
- Layout: [`docs/00_Project_Vision.md`](../../docs/00_Project_Vision.md) §8

## Layout (estado vacío, sin Core conectado)

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (Anonly + Importar PDF + Settings)               │
├──────────────────┬───────────────────────────────────────┤
│  Entidades       │                                       │
│  (empty state)   │              Hero                     │
├──────────────────┤   (arrastrar PDF + features)          │
│  Reglas          │                                       │
│  (empty state)   │                                       │
└──────────────────┴───────────────────────────────────────┘
```

## Stores (Zustand, `src/store/`)

Placeholders de `docs/ui/React_Client.md` §3: `document.store.ts`,
`entities.store.ts`, `rules.store.ts`, `pipeline.store.ts`, `viewer.store.ts`,
`settings.store.ts`. Cada uno implementa la forma exacta del spec y es
autocontenido (sin dependencias entre stores, sin conexión al bus). La
mutación por eventos del Core (`core-adapter/bus-bridge.ts`) llega en el PR5
del Hito 10.

## Stack

- **React 18** + **TypeScript estricto**
- **Vite 5** como bundler
- **Tailwind CSS 3** para estilos (tokens de `docs/ui/Components.md` §10)
- **Radix UI** para primitives accesibles (Dialog, Select, Checkbox, Tooltip, Toast)
- **Zustand** para estado UI (slices por dominio)
- **lucide-react** para iconos

## Scripts

```bash
pnpm dev          # arranca Vite dev server (http://localhost:5173)
pnpm build        # build de producción
pnpm preview      # sirve el build localmente
pnpm typecheck    # tsc --noEmit
```

## Reglas (docs/ai/Code_Standards.md §12)

- El cliente puede importar React y librerías de UI.
- El cliente **nunca** importa internos de motores, solo `@anonly/anonymization-core` (API pública).
- El cliente **nunca** contiene lógica de anonimización; toda va al Core.
- Comunicación con el Core: únicamente por eventos del `IEventBus` y por la API pública de `@anonly/anonymization-core`.

## CSP

El `index.html` declara una CSP estricta (ver `docs/architecture/08_Security_Model.md` §3.2):

- `default-src 'self'`
- `script-src 'self'` (sin `unsafe-eval`)
- `worker-src 'self'`
- `connect-src 'self'` (sin third-party)
- `object-src 'none'`, `frame-src 'none'`

`unsafe-inline` en `style-src` es requerido por Tailwind en dev; se elimina en v1.0 con build que extrae CSS a archivo.
