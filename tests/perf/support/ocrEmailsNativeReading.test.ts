import { describe, expect, it } from "vitest";

import {
  EMAIL_READINGS,
  classifyLostEmail,
  countQCandidates,
  editDistance,
  findQShapedCandidates,
  nearestFragment,
} from "./ocrEmailsNativeReading.js";

describe("editDistance", () => {
  it("cuenta inserciones, borrados y sustituciones", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("classifyLostEmail", () => {
  it("la @ leída como Q", () => {
    const result = classifyLostEmail(
      "ricardo.ibarra@example.org",
      "Escribir a ricardo.ibarraQexample.org para consultas",
    );
    expect(result).toEqual({
      expected: "ricardo.ibarra@example.org",
      reading: "at-as-q",
      fragment: "ricardo.ibarraQexample.org",
    });
  });

  it("la Q minúscula también es la @ leída como Q (se compara sin distinguir mayúsculas)", () => {
    expect(classifyLostEmail("ana@example.com", "ver anaqexample.com hoy").reading).toBe("at-as-q");
  });

  it("el punto del nombre leído como espacio", () => {
    const result = classifyLostEmail(
      "marina.suarez@example.com",
      "Contacto marina suarez@example.com fin",
    );
    expect(result.reading).toBe("dot-as-space");
    expect(result.fragment).toBe("marina suarez@example.com");
  });

  it("el punto del nombre seguido de un espacio también cuenta como espacio", () => {
    expect(
      classifyLostEmail("contacto.estudio@example.org", "web contacto. estudio@example.org fin")
        .reading,
    ).toBe("dot-as-space");
  });

  it("las dos cosas a la vez", () => {
    const result = classifyLostEmail(
      "contacto.estudio@example.org",
      "mail contacto. estudioQexample.org gracias",
    );
    expect(result.reading).toBe("at-as-q-and-dot-as-space");
    expect(result.fragment).toBe("contacto. estudioQexample.org");
  });

  it("un punto del dominio leído como espacio no es una de las lecturas definidas: otra lectura", () => {
    const result = classifyLostEmail("ana@example.com", "ver ana@example com hoy");
    expect(result.reading).toBe("other-reading");
    expect(result.fragment).toContain("ana@example");
  });

  it("otra lectura guarda el fragmento más parecido (una letra confundida)", () => {
    const result = classifyLostEmail(
      "ricardo.ibarra@example.org",
      "Datos ricardo.ibarra@exampIe.org y nada más",
    );
    expect(result.reading).toBe("other-reading");
    expect(result.fragment).toBe("ricardo.ibarra@exampIe.org");
  });

  it("el email escrito tal cual en el texto es «intacto»: la pérdida no es de la lectura", () => {
    const result = classifyLostEmail("ana.paz@example.com", "mail ana.paz@example.com ok");
    expect(result.reading).toBe("intact-in-text");
    expect(result.fragment).toBe("ana.paz@example.com");
  });

  it("sin nada parecido en el texto: not-found y sin fragmento", () => {
    expect(classifyLostEmail("ricardo.ibarra@example.org", "texto sin relación alguna")).toEqual({
      expected: "ricardo.ibarra@example.org",
      reading: "not-found",
      fragment: null,
    });
    expect(classifyLostEmail("ricardo.ibarra@example.org", "")).toMatchObject({
      reading: "not-found",
    });
  });

  it("un nombre sin puntos solo puede ser @ como Q, intacto u otra lectura", () => {
    expect(classifyLostEmail("pedro@example.com", "ver pedroQexample.com").reading).toBe("at-as-q");
    expect(classifyLostEmail("pedro@example.com", "ver ped ro@example.com").reading).not.toBe(
      "dot-as-space",
    );
  });

  it("el borde izquierdo evita confundir un sufijo de otra cadena", () => {
    expect(classifyLostEmail("ana@example.com", "xana@example.com").reading).not.toBe(
      "intact-in-text",
    );
  });

  it("una dirección mal formada es not-found", () => {
    expect(classifyLostEmail("sin-arroba", "sin-arroba").reading).toBe("not-found");
    expect(classifyLostEmail("@example.com", "x").reading).toBe("not-found");
  });

  it("todas las lecturas posibles están listadas", () => {
    expect([...EMAIL_READINGS].sort()).toEqual(
      [
        "at-as-q",
        "at-as-q-and-dot-as-space",
        "dot-as-space",
        "intact-in-text",
        "not-found",
        "other-reading",
      ].sort(),
    );
  });
});

describe("nearestFragment", () => {
  it("elige el email y no el nombre de la persona que comparte el ancla", () => {
    const text = "Ricardo Ibarra vive aquí. Mail ricardo.ibarra@exampIe.org gracias";
    expect(nearestFragment("ricardo.ibarra@example.org", text)).toBe("ricardo.ibarra@exampIe.org");
  });

  it("no inventa un fragmento si lo más parecido está demasiado lejos", () => {
    expect(
      nearestFragment("ricardo.ibarra@example.org", "ricardo y otra cosa totalmente distinta"),
    ).toBeNull();
  });
});

describe("findQShapedCandidates", () => {
  const truth = ["ricardo.ibarra@example.org", "contacto.estudio@example.org"];

  it("una reconstrucción igual a un email de la verdad es recuperable", () => {
    const [candidate] = findQShapedCandidates("ver ricardo.ibarraQexample.org hoy", truth);
    expect(candidate).toEqual({
      token: "ricardo.ibarraQexample.org",
      reconstructed: "ricardo.ibarra@example.org",
      relation: "recoverable",
    });
  });

  it("la reconstrucción que es el final de un email de la verdad es parcial (un espacio partió el nombre)", () => {
    const candidates = findQShapedCandidates("contacto. estudioQexample.org", truth);
    expect(candidates.map((c) => [c.reconstructed, c.relation])).toEqual([
      ["estudio@example.org", "partial-of-truth"],
    ]);
  });

  it("una cadena con forma Q que no es ningún email de la verdad es ajena: la cota de falsos positivos", () => {
    const candidates = findQShapedCandidates("ver pepeQexample.net y ruidoQotro.com.ar", truth);
    expect(candidates.map((c) => c.relation)).toEqual(["unrelated", "unrelated"]);
    expect(countQCandidates(candidates)).toEqual({
      total: 2,
      recoverable: 0,
      partialOfTruth: 0,
      unrelated: 2,
    });
  });

  it("recorta la puntuación de los bordes y usa la última Q con un dominio a la derecha", () => {
    const [candidate] = findQShapedCandidates("(aQbQexample.org).", []);
    expect(candidate?.token).toBe("aQbQexample.org");
    expect(candidate?.reconstructed).toBe("aQb@example.org");
  });

  it("sin Q mayúscula, sin dominio con punto o con un email legítimo no hay candidato", () => {
    expect(findQShapedCandidates("ana@example.com anaqexample.com Quéexample", [])).toEqual([]);
    expect(findQShapedCandidates("nombreQlocalhost", [])).toEqual([]);
    expect(findQShapedCandidates("", [])).toEqual([]);
  });

  it("cuenta cada relación por separado", () => {
    const candidates = findQShapedCandidates(
      "ricardo.ibarraQexample.org estudioQexample.org pepeQexample.net",
      truth,
    );
    expect(countQCandidates(candidates)).toEqual({
      total: 3,
      recoverable: 1,
      partialOfTruth: 1,
      unrelated: 1,
    });
  });
});
