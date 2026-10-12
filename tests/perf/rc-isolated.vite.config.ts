import { writeFileSync } from "node:fs";

import {
  createRcTransformIdentity,
  transformRcSource,
  type RcArm,
  type RcSourceMode,
} from "./support/rcIsolatedTransform.js";

export interface RcTransformPluginOptions {
  readonly arm: RcArm;
  readonly mode: RcSourceMode;
  readonly identityFile: string;
  readonly sourceFile: string;
  readonly source: string;
}

export function createRcTransformPlugin(options: RcTransformPluginOptions) {
  const target = options.sourceFile.replaceAll("\\", "/");
  const transformed = transformRcSource(options.source, options.arm, options.mode);
  let seen = 0;
  return {
    name: "anonly-experiment-rc-exact-predicate",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (id.replaceAll("\\", "/").split("?")[0] !== target) return null;
      if (code !== options.source || ++seen !== 1)
        throw new Error("RC build source identity mismatch");
      return transformed === options.source ? null : { code: transformed, map: null };
    },
    closeBundle() {
      if (seen !== 1) throw new Error("RC build transform not uniquely observed");
      writeFileSync(
        options.identityFile,
        JSON.stringify(
          createRcTransformIdentity(options.source, options.arm, options.mode),
          null,
          2,
        ),
      );
    },
  };
}
