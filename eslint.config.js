import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      // "coverage/**" solo ancla a la raíz (semántica de .gitignore: un "/"
      // no final vuelve el patrón relativo al directorio del config). Los
      // reportes de `pnpm test:coverage` se generan por paquete
      // (packages/**/coverage/), y sin este segundo patrón ESLint intenta
      // lintear el JS del reporter HTML de v8 y falla con parsing errors.
      "**/coverage/**",
      // Salida de `electron-builder` (`apps/desktop-shell/release/`). Mismo
      // motivo y misma semántica que el patrón de coverage de arriba: un
      // patrón sin "/" inicial ancla a la raíz, así que `build/**` no lo
      // cubre. Adentro viene el bundle entero de Electron —miles de archivos
      // JS de terceros— y ESLint no falla con un error de lint: se queda sin
      // memoria y tira el proceso de Node entero.
      //
      // Comentarios de línea y no de bloque a propósito: un glob como el de
      // abajo contiene la secuencia que cierra un comentario `/*`, así que
      // citarlo adentro de uno parte el archivo en dos.
      "**/release/**",
      "**/*.d.ts",
      ".changeset/**",
      "playwright-report/**",
      "test-results/**",
      "**/dist/**",
      // Skills de Claude Code instaladas localmente: sus scripts `.cjs` no
      // están en ningún tsconfig, así que el type-aware linting los rechaza
      // con "was not found by the project service" y rompía `pnpm lint`
      // entero. No son código del proyecto (ver `.gitignore`).
      ".claude/skills/**",
      // Assets vendor mirroreados por scripts/mirror-assets.ts (ADR-018):
      // bundles de terceros descargados tal cual, no código propio.
      "apps/react-client/public/wasm/**",
      "apps/react-client/public/models/**",
      // ADR-039 §3: los dos archivos de onnxruntime-web movidos a src/assets/
      // (Vite los procesa como módulos vía `?url`) siguen siendo vendor, no
      // código propio — mismo criterio que los de public/ de arriba.
      "apps/react-client/src/assets/onnxruntime/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.js",
            "commitlint.config.js",
            "vitest.config.ts",
            "playwright.config.ts",
            "playwright.measure.config.ts",
            "apps/react-client/postcss.config.js",
            "apps/react-client/tailwind.config.js",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // no-unnecessary-type-assertion conflicta con noUncheckedIndexedAccess
      // (no detecta que arr[i] es T | undefined). Preferimos noUncheckedIndexedAccess.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      import: importPlugin,
    },
    rules: {
      // Reglas de Code_Standards.md §12 — Prohibiciones absolutas
      "no-console": [
        "error",
        {
          allow: ["warn", "error"],
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
      "import/no-default-export": "error",
      "import/no-cycle": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/jsx-runtime"],
              message: "El Core no puede importar React. Ver ai/Code_Standards.md P-1.",
              allowTypeImports: false,
            },
          ],
          paths: [
            {
              name: "react",
              message: "El Core no puede importar React. Ver ai/Code_Standards.md P-1.",
            },
          ],
        },
      ],
    },
  },
  {
    // P-4 estricto: nada de console.* en packages/ (ai/Code_Standards.md §12).
    // Opciones {} explícitas — con severidad sola, flat config heredaría el
    // allow: ["warn", "error"] del bloque general (y allow exige minItems 1,
    // no admite []). Los tests (más abajo) re-habilitan console solo en tests.
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", {}],
    },
  },
  {
    // Motores, shared y event-system: nunca importan otro motor ni el façade.
    // Los nombres reales de los paquetes son @anonly/<engine>-engine (ver package.json
    // de cada paquete), no subpaths de @anonly/anonymization-core.
    files: ["packages/anonymization-core/**/*.{ts,tsx}"],
    ignores: ["packages/anonymization-core/src/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/jsx-runtime"],
              message: "El Core no puede importar React. Ver ai/Code_Standards.md P-1.",
            },
            {
              group: ["@anonly/*-engine"],
              message:
                "Un motor no puede importar otro motor. Comunicación solo por eventos. Ver ai/Code_Standards.md P-2.",
              allowTypeImports: false,
            },
            {
              group: ["@anonly/anonymization-core"],
              message:
                "Un motor no puede importar el façade del Core (dependencia circular). Ver ai/Code_Standards.md P-2.",
              allowTypeImports: false,
            },
            {
              group: ["@anonly/event-system"],
              message:
                "Los motores usan el IEventBus inyectado por ctx (@anonly/shared); no importan la implementación del bus. Ver ai/Code_Standards.md §12.",
              allowTypeImports: false,
            },
            {
              group: ["@anonly/test-utils"],
              message:
                "`@anonly/test-utils` son dobles de test: solo se importa desde `__tests__`. Es `private: true` y devDependency, así que un import desde `src/` es una dependencia de desarrollo usada en producción. Ver ADR-129.",
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
  {
    // Tests de paquetes del Core: pueden importar @anonly/event-system para armar
    // un bus real (tests de integración). El resto de prohibiciones se mantiene.
    // no-restricted-imports no se mergea entre bloques: se redeclara completa.
    //
    // `test-utils` entra en la misma excepción (ADR-129) y por la misma razón:
    // **no es un motor**, es el paquete de dobles que las suites del Core
    // consumen, y su `createEngineContextWithRealBus` existe justamente para
    // armar ese bus real. Es `private: true` y devDependency, así que no puede
    // llegar a producción ni por accidente. La prohibición sigue rigiendo para
    // los siete motores, que es a quienes apunta P-2.
    files: [
      "packages/anonymization-core/**/__tests__/**/*.{ts,tsx}",
      "packages/anonymization-core/test-utils/src/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/jsx-runtime"],
              message: "El Core no puede importar React. Ver ai/Code_Standards.md P-1.",
            },
            {
              group: ["@anonly/*-engine"],
              message:
                "Un motor no puede importar otro motor. Comunicación solo por eventos. Ver ai/Code_Standards.md P-2.",
              allowTypeImports: false,
            },
            {
              group: ["@anonly/anonymization-core"],
              message:
                "Un motor no puede importar el façade del Core (dependencia circular). Ver ai/Code_Standards.md P-2.",
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
  {
    // Façade del Core (@anonly/anonymization-core): es la composition root (createCore,
    // Orchestrator). Es el ÚNICO lugar del Core autorizado a importar motores.
    files: ["packages/anonymization-core/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/jsx-runtime"],
              message: "El Core no puede importar React. Ver ai/Code_Standards.md P-1.",
            },
            {
              group: ["@anonly/test-utils"],
              message:
                "`@anonly/test-utils` son dobles de test: solo se importa desde `__tests__`. Es `private: true` y devDependency, así que un import desde `src/` es una dependencia de desarrollo usada en producción. Ver ADR-129.",
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
  {
    // Tests del façade. En flat config el último bloque que matchea gana, y el
    // del façade (arriba) matchea también sus `__tests__`: sin este bloque,
    // esos tests heredarían la prohibición de `@anonly/test-utils`, y el
    // façade sería el único del Core cuyos tests no pueden usar los dobles
    // compartidos (ADR-129).
    //
    // Se redeclara completo y no se "quita una regla": `no-restricted-imports`
    // no se mergea entre bloques. Queda solo React — el façade **sí** puede
    // importar motores (P-1: es el único que puede) y el bus.
    files: ["packages/anonymization-core/src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/jsx-runtime"],
              message: "El Core no puede importar React. Ver ai/Code_Standards.md P-1.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Tests usan @ts-expect-error y casts intencionales
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      // expect(mock.someMethod).toHaveBeenCalled() dispara un falso positivo:
      // ILogger/IEventBus declaran sus miembros con sintaxis de método, y
      // unbound-method los trata como tal sin importar cómo se referencien
      // (asignarlos a una variable antes no cambia el tipo). Mismo criterio
      // que require-await: off arriba.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["apps/react-client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "import/no-default-export": "off",
    },
  },
  {
    /*
     * Scripts de build del shell. Corren bajo Electron (o sea Node) y viven
     * fuera de todo tsconfig, así que el project service no les da tipos y
     * `no-undef` no conoce los globals de Node. Se declaran acá en vez de
     * meterlos al tsconfig del paquete: ese compila a `dist/` lo que se
     * empaqueta, y un generador de assets no se empaqueta.
     */
    files: ["apps/desktop-shell/scripts/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        exports: "writable",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.config.{js,ts,mjs,cjs}", "commitlint.config.js"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "import/no-default-export": "off",
      "@typescript-eslint/require-await": "off",
      // Self-linting de config files con type-checked rules es problemático
      // (types de plugins no se resuelven fuera de un project). Ver:
      // https://typescript-eslint.io/troubleshooting/untyped-imports
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  prettier,
);
