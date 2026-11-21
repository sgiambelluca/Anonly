/**
 * `detectionToEngineConfig`, `deriveCoreOverrides` y la comparación de la
 * sección `detection` en `sameEngineConfigOverrides` (`React_Client.md` §3.8,
 * tabla «Mapeo `detection.saved` → `EngineConfig.detection`»).
 */

import { EntityType } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  deriveCoreOverrides,
  deriveEngineConfigOverrides,
  detectionToEngineConfig,
  sameEngineConfigOverrides,
} from "../core-adapter/settingsToEngineConfig.js";
import { DEFAULT_DETECTION_STATE } from "../store/detectionState.js";

import { stateWith, userFormat, userType } from "./helpers/detectionFixtures.js";

const SETTINGS = { performancePreset: "low", nerEnabled: true, ocrLanguages: ["spa"] } as const;

describe("detectionToEngineConfig", () => {
  it("el estado por defecto es la detección de la 1.0.2: país AR y nada propio", () => {
    expect(detectionToEngineConfig(DEFAULT_DETECTION_STATE)).toEqual({
      country: "AR",
      baseFormats: [],
      userTypes: [],
      userFormats: [],
      catalogRefs: [],
    });
  });

  it("un formato base sin entrada está prendido: solo viajan los apagados del país activo", () => {
    const config = detectionToEngineConfig(
      stateWith({ disabledBaseFormats: { AR: ["dni-ar", "email"] } }),
    );
    expect(config.baseFormats).toEqual([
      { formatId: "dni-ar", enabled: false },
      { formatId: "email", enabled: false },
    ]);
  });

  it("de las copias editadas solo viajan las que tienen `basedOn` en el catálogo del país", () => {
    const own = userFormat(0, "Propio");
    const goodCopy = userFormat(1, "DNI propio", EntityType.DNI, { basedOn: "dni-ar" });
    const orphanCopy = userFormat(2, "Copia huérfana", EntityType.DNI, { basedOn: "cl:rut" });
    const type = userType(0, "Legajo");
    const config = detectionToEngineConfig(
      stateWith({ userTypes: [type], userFormats: [own, goodCopy, orphanCopy] }),
    );
    expect(config.userTypes).toEqual([type]);
    expect(config.userFormats).toEqual([own, goodCopy]);
  });
});

describe("deriveCoreOverrides", () => {
  it("suma la sección `detection` a los overrides de los settings", () => {
    const overrides = deriveCoreOverrides(SETTINGS, DEFAULT_DETECTION_STATE, {});
    expect(overrides.ner).toEqual({ enabled: true });
    expect(overrides.detection).toEqual(detectionToEngineConfig(DEFAULT_DETECTION_STATE));
  });
});

describe("sameEngineConfigOverrides con `detection`", () => {
  const base = deriveCoreOverrides(SETTINGS, DEFAULT_DETECTION_STATE, {});

  it("dos configuraciones de detección iguales son iguales, sin importar el orden de las claves", () => {
    const a = deriveCoreOverrides(
      SETTINGS,
      stateWith({ userFormats: [userFormat(0, "Interno")] }),
      {},
    );
    const reordered = userFormat(0, "Interno");
    const b = deriveCoreOverrides(
      SETTINGS,
      stateWith({
        userFormats: [
          {
            enabled: reordered.enabled,
            variants: reordered.variants,
            entityType: reordered.entityType,
            name: reordered.name,
            id: reordered.id,
          },
        ],
      }),
      {},
    );
    expect(sameEngineConfigOverrides(a, b)).toBe(true);
  });

  it("apagar un formato base, sumar un tipo o cambiar un formato cambia el override", () => {
    const off = deriveCoreOverrides(
      SETTINGS,
      stateWith({ disabledBaseFormats: { AR: ["dni-ar"] } }),
      {},
    );
    const withType = deriveCoreOverrides(
      SETTINGS,
      stateWith({ userTypes: [userType(0, "Legajo")] }),
      {},
    );
    const withFormat = deriveCoreOverrides(
      SETTINGS,
      stateWith({ userFormats: [userFormat(0, "Interno")] }),
      {},
    );
    const renamed = deriveCoreOverrides(
      SETTINGS,
      stateWith({ userFormats: [userFormat(0, "Interno 2")] }),
      {},
    );
    expect(sameEngineConfigOverrides(base, off)).toBe(false);
    expect(sameEngineConfigOverrides(base, withType)).toBe(false);
    expect(sameEngineConfigOverrides(base, withFormat)).toBe(false);
    expect(sameEngineConfigOverrides(withFormat, renamed)).toBe(false);
  });

  it("una sección `detection` ausente es la detección de la 1.0.2: igual a los defaults, distinta de lo propio", () => {
    const withoutDetection = deriveEngineConfigOverrides(SETTINGS, {});
    expect(sameEngineConfigOverrides(withoutDetection, withoutDetection)).toBe(true);
    expect(sameEngineConfigOverrides(withoutDetection, base)).toBe(true);
    const own = deriveCoreOverrides(
      SETTINGS,
      stateWith({ userTypes: [userType(0, "Legajo")] }),
      {},
    );
    expect(sameEngineConfigOverrides(withoutDetection, own)).toBe(false);
  });

  it("apagar y volver a prender un formato deja el override igual", () => {
    const toggled = deriveCoreOverrides(
      SETTINGS,
      stateWith({ disabledBaseFormats: { AR: [] } }),
      {},
    );
    expect(sameEngineConfigOverrides(base, toggled)).toBe(true);
  });
});
