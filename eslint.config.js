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
      "**/*.d.ts",
      ".changeset/**",
      "playwright-report/**",
      "test-results/**",
      "**/dist/**",
      // Assets vendor mirroreados por scripts/mirror-assets.ts (ADR-018):
      // bundles de terceros descargados tal cual, no código propio.
      "apps/react-client/public/wasm/**",
      "apps/react-client/public/models/**",
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
          ],
        },
      ],
    },
  },
  {
    // Tests de paquetes del Core: pueden importar @anonly/event-system para armar
    // un bus real (tests de integración). El resto de prohibiciones se mantiene.
    // no-restricted-imports no se mergea entre bloques: se redeclara completa.
    files: ["packages/anonymization-core/**/__tests__/**/*.{ts,tsx}"],
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
