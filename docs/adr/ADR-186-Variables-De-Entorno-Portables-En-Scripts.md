<!-- CONTEXT: scope=adr | dependencias=ai/AI_Development_Guide.md,architecture/07_Performance_Strategy.md,roadmap/Gates_Leak_Stress_Plan.md,adr/ADR-185-Gates-De-Leak-Y-Stress-En-Electron.md,tests/perf/README.md | audiencia=humanos+IA | fase=11 -->

# ADR-186 — Variables de entorno portables en los scripts de `package.json`

- **Estado**: Aceptado.
- **Fecha**: 2026-09-26.
- **Decidido por**: el humano, a propuesta del planificador.
- **Alcance**: herramientas de desarrollo. Agrega una `devDependency`
  (`cross-env`) y cambia cuatro scripts. Sin cambio de producto, contrato,
  build distribuido ni comportamiento para el usuario.

## Contexto

Cuatro scripts de `package.json` definen una variable de entorno con sintaxis
POSIX antes de compilar:

```
"test:e2e": "VITE_E2E=1 pnpm --filter @anonly/react-client build && ..."
```

Lo mismo hacen `test:perf`, `test:stress` y `test:leak`. pnpm ejecuta los
scripts con el shell del sistema. En macOS y Linux es `sh`, que acepta el
prefijo `VARIABLE=valor comando`. En Windows es `cmd.exe`, que lo toma como el
nombre de un programa y aborta con «"VITE_E2E" no se reconoce como un comando
interno o externo», antes del build. Medido el 2026-09-26 al correr
`test:leak` y `test:stress` en Windows nativo: los dos cortaron en ese punto.

CI no lo detecta porque sus jobs corren en `macos-latest`. En Windows, las
campañas de medición del 2026-09-19 al 2026-09-26 compilaron siempre a mano
desde Git Bash, sin llamar a estos scripts; antes, el flujo de Windows pasaba
por WSL. R-12 exige ADR para cualquier dependencia externa nueva.

## Decisión

1. Se agrega **`cross-env`** como `devDependency` de la raíz del monorepo.
   Es la herramienta estándar para definir variables de entorno en scripts de
   npm/pnpm de forma portable entre `sh` y `cmd.exe`. Licencia MIT; exige
   Node ≥ 20, dentro del mínimo del repo (≥ 22); dependencias transitivas:
   `cross-spawn` y `@epic-web/invariant`.
2. Los cuatro scripts pasan de `VITE_E2E=1 pnpm ...` a
   `cross-env VITE_E2E=1 pnpm ...`. El valor, el orden de los pasos y las
   configuraciones de Playwright no cambian.
3. `cross-env` **no entra al producto**: no se importa desde `apps/` ni desde
   `packages/`, no forma parte del build de React ni del shell, y no viaja en
   el instalador.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| `script-shell` de pnpm apuntando a bash | Depende de que cada máquina Windows tenga Git Bash en una ruta conocida; lo que corre en un equipo falla en otro. |
| Mantener los pasos a mano en Windows | Es lo que se venía haciendo sin saberlo. Deja los comandos de la tabla canónica de gates sin funcionar en una plataforma de desarrollo. |
| Leer la variable desde un archivo `.env` de Vite | Cambia cómo se activa el build instrumentado para todos los consumidores; más superficie que el problema. |

## Consecuencias

- `pnpm test:e2e`, `test:perf`, `test:stress` y `test:leak` corren igual en
  macOS, Linux y Windows nativo.
- `pnpm-lock.yaml` suma `cross-env` y sus dos transitivas.
- Los scripts nuevos que necesiten una variable de entorno usan `cross-env`
  en vez del prefijo POSIX.
