/**
 * Gate `updater-payload-clean` (ADR-132 §5, ADR-131 §5).
 *
 * La propiedad a sostener: por el canal del actualizador **nunca** viaja
 * contenido, nombre ni metadato de un documento. Se prueba sobre la
 * construcción del payload y no en runtime porque en runtime haría falta un
 * chequeo real contra un servidor — y lo que puede filtrar no es la red, es
 * esta función.
 */

import { describe, expect, it } from "vitest";

import { toUpdateEventPayload, type SparkleEvent } from "../updater";

describe("toUpdateEventPayload", () => {
  it("deja pasar solo el ciclo de vida", () => {
    expect(
      toUpdateEventPayload({ type: "update-downloaded", version: "0.9.1", percent: 100 }),
    ).toEqual({ type: "update-downloaded", version: "0.9.1", percent: 100 });
  });

  it("omite lo ausente en vez de mandar undefined", () => {
    expect(toUpdateEventPayload({ type: "checking" })).toEqual({ type: "checking" });
  });

  it("descarta cualquier campo que no esté en la lista blanca", () => {
    /*
     * El caso que importa: Sparkle gana un campo nuevo en una versión futura,
     * o alguien agrega uno con datos del documento. Con una copia por spread
     * eso viajaría al renderer sin que nada avise. Acá se cae solo.
     */
    const conExtras = {
      type: "update-downloaded",
      version: "0.9.1",
      releaseNotes: "<h1>notas</h1>",
      message: "no se pudo leer /Users/alguien/pericia.pdf",
      documentName: "pericia-juan-perez.pdf",
      rutaLocal: "/Users/alguien/Documentos/pericia.pdf",
    } as unknown as SparkleEvent;

    const payload = toUpdateEventPayload(conExtras);

    expect(Object.keys(payload).sort()).toEqual(["type", "version"]);
    expect(JSON.stringify(payload)).not.toContain("perez");
    expect(JSON.stringify(payload)).not.toContain("Documentos");
  });
});
