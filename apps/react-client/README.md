# @anonly/react-client

Cliente web de Anonly (React + Vite + Tailwind + Radix UI + Zustand).

> App SPA que consume el `@anonly/anonymization-core`. En Hito 1 esto es un esqueleto con el layout de 4 paneles y estados vacíos. La lógica (core-adapter, stores, componentes) se implementa en el Hito 10.

## Documentación

- UI Contract: [`docs/ui/React_Client.md`](../../docs/ui/React_Client.md)
- UX Guidelines: [`docs/ui/UX_Guidelines.md`](../../docs/ui/UX_Guidelines.md)
- Componentes: [`docs/ui/Components.md`](../../docs/ui/Components.md)
- Layout: [`docs/00_Project_Vision.md`](../../docs/00_Project_Vision.md) §8

## Layout (Hito 1 — placeholder)

```
┌──────────────────────────────────────────────────────────┐
│  Toolbar (Anonly + Importar PDF + Settings)               │
├──────────────────┬───────────────────────────────────────┤
│  Entidades       │            PDF original               │
│  (empty state)   │            (empty state)              │
├──────────────────┼───────────────────────────────────────┤
│  Reglas          │            PDF anonimizado            │
│  (empty state)   │            (empty state)              │
└──────────────────┴───────────────────────────────────────┘
```

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
