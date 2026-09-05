/**
 * Los destinos de red que el shell puede alcanzar, enumerados desde el código.
 *
 * Complementa al gate `shell-no-egress` (ADR-132 §5) y **cubre justo lo que
 * ese gate no puede**: los E2E corren la app desempaquetada, donde el
 * `Info.plist` no tiene `SUPublicEDKey` y el actualizador ni siquiera arranca.
 * O sea que el único componente que habla con la red nunca está presente
 * cuando el gate corre: hoy pasa por ausencia.
 *
 * Este test no depende del runtime. Lee el propio código del shell y afirma
 * que **no existe** ninguna URL de red fuera de la lista blanca. Si alguien
 * agrega un endpoint de telemetría, un reporte de crashes o un "solo un ping
 * para saber cuántos usuarios hay", se cae acá — que es el momento en que hay
 * que discutirlo, no después de publicado.
 */

import { access } from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";

/*
 * Ruta relativa a la raíz del repo, no al cwd: así el test da lo mismo corrido
 * desde la raíz (`pnpm test`) o desde el paquete (`pnpm --filter`). `beforeAll`
 * verifica que exista, así que una ruta rota hace fallar el test en vez de
 * dejarlo pasar sobre cero archivos.
 */
const SRC = desdeLaRaiz("apps/desktop-shell/src");

/**
 * Los únicos destinos que el producto tiene permitido nombrar.
 *
 * Ambos son el mismo canal —el actualizador de ADR-131— visto desde las dos
 * plataformas: macOS consulta el appcast, y `electron-updater` en Windows
 * deriva su URL del `publish` de `electron-builder.yml`, no de una constante.
 */
const PERMITIDOS = [
  "https://github.com/sgiambelluca/Anonly/releases/latest/download/appcast.xml",
  // Documentación de Sparkle, citada en un comentario.
  "https://sparkle-project.org",
];

async function archivosFuente(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true });
  const salida: string[] = [];
  for (const e of entradas) {
    if (e.name === "__tests__") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) salida.push(...(await archivosFuente(p)));
    else if (e.name.endsWith(".ts")) salida.push(p);
  }
  return salida;
}

describe("destinos de red del shell", () => {
  beforeAll(async () => {
    await expect(
      access(SRC),
      `no se encontró ${SRC}: ¿el test corre desde otra raíz?`,
    ).resolves.toBeUndefined();
  });

  it("no nombra ninguna URL fuera de la lista blanca", async () => {
    const encontradas = new Set<string>();
    for (const archivo of await archivosFuente(SRC)) {
      const contenido = await readFile(archivo, "utf8");
      for (const url of contenido.match(/https?:\/\/[^\s"'`)]+/g) ?? []) {
        encontradas.add(url.replace(/[.,;]+$/, ""));
      }
    }

    const fuera = [...encontradas].filter(
      (u) => !PERMITIDOS.some((permitido) => u.startsWith(permitido)),
    );
    expect(fuera, `destinos de red no autorizados en el shell: ${JSON.stringify(fuera)}`).toEqual(
      [],
    );
  });

  it("el appcast sigue siendo una constante, no una plantilla", async () => {
    // Una URL armada con interpolación podría llevar datos del documento sin
    // que se note. La del actualizador es literal y tiene que seguir siéndolo.
    const main = await readFile(join(SRC, "main.ts"), "utf8");
    expect(main).toContain(`const APPCAST_URL = "${PERMITIDOS[0]}"`);
  });
});
