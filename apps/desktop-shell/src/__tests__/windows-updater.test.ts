/**
 * La condición de salida de ADR-136, hecha ejecutable.
 *
 * ADR-136 decide que el actualizador de Windows aplica actualizaciones **sin
 * verificar la firma**, porque el instalador sale sin certificado de firma de
 * código. Es un hueco real y acotado, y su condición de cierre —"cuando exista
 * el certificado"— antes vivía en un comentario, que no se ejecuta.
 *
 * Estos dos tests la ejecutan. No prueban el actualizador (eso necesita
 * Windows y un release publicado): fijan las dos afirmaciones sobre las que
 * ADR-136 se apoya, para que ninguna se mueva en silencio.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";

/*
 * Rutas relativas a la raíz del repo, no al cwd: así el test da lo mismo
 * corrido desde la raíz o desde el paquete. El `beforeAll` deja que una ruta
 * rota falle en vez de pasar sobre un archivo vacío.
 */
const BUILDER = desdeLaRaiz("apps/desktop-shell/electron-builder.yml");
const FUENTE = desdeLaRaiz("apps/desktop-shell/src/windows-updater.ts");

let builder = "";
let fuente = "";

/**
 * El código, sin los comentarios.
 *
 * Hace falta porque el comentario que explica **por qué** no se asigna
 * `verifyUpdateCodeSignature` nombra el flag, y sin esto el test se atraparía
 * a sí mismo. Lo que se afirma es sobre el código, no sobre la prosa que lo
 * explica.
 */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

beforeAll(async () => {
  builder = await readFile(BUILDER, "utf8");
  fuente = await readFile(FUENTE, "utf8");
  expect(builder.length, `no se pudo leer ${BUILDER}`).toBeGreaterThan(0);
  expect(fuente.length, `no se pudo leer ${FUENTE}`).toBeGreaterThan(0);
});

describe("verificación de firma en Windows (ADR-136)", () => {
  /*
   * Este es el test que se rompe cuando el hueco se cierra, y romperse es su
   * trabajo. `electron-updater` saltea la verificación solo mientras
   * `publisherName` no esté configurado (`NsisUpdater.verifySignature()`
   * retorna `null` antes de llamar al verificador). El día que llegue el
   * certificado, `electron-builder` va a escribirlo y la verificación se
   * enciende sola: acá hay que venir a actualizar ADR-136, no a descubrirlo
   * leyendo el código de la dependencia.
   */
  it("electron-builder.yml no declara certificado: es lo que hoy saltea la verificación", () => {
    for (const clave of [
      "publisherName",
      "certificateFile",
      "certificateSubjectName",
      "certificateSha1",
    ]) {
      expect(
        builder,
        `\`${clave}\` apareció en electron-builder.yml: llegó el certificado, así que la verificación de Authenticode se enciende y el hueco de ADR-136 se cierra. Confirmá que además esté \`publisherName\` —firmar con SignPath no alcanza, ADR-136 §2—, actualizá el ADR y borrá este test.`,
      ).not.toContain(clave);
    }
  });

  /*
   * La primera implementación asignaba `verifyUpdateCodeSignature = false`
   * creyendo que apagaba la verificación, con un comentario que explicaba en
   * detalle un mecanismo inexistente. No apaga nada: es un accessor cuyo valor
   * es una función, y su setter descarta los falsy —
   *
   *     set verifyUpdateCodeSignature(value) {
   *         if (value) { this._verifyUpdateCodeSignature = value; }
   *     }
   *
   * — así que el verificador por defecto quedaba instalado igual. El cast
   * `as unknown as { verifyUpdateCodeSignature?: boolean }` es lo que le mintió
   * al type-checker sobre el tipo real y dejó pasar el no-op; sin él, `tsc`
   * habría rechazado la asignación.
   *
   * Vuelve fácil: es lo primero que sugiere cualquier issue sobre el tema.
   */
  it("el shell no intenta apagar la verificación con un flag que no existe", () => {
    expect(
      sinComentarios(fuente),
      "asignar `verifyUpdateCodeSignature` es un no-op: el setter de electron-updater descarta los falsy. Si hace falta desactivar la verificación de verdad, se pasa una función de verificación propia y se documenta en ADR-136.",
    ).not.toMatch(/verifyUpdateCodeSignature\s*=/);
  });
});
