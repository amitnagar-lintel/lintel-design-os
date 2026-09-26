import type { ResolvedCabinet } from "@lintel/types";
import { hash53, stableStringify } from "@lintel/types";

export { stableStringify } from "@lintel/types";

/**
 * Fingerprint of the resolved model (components, hardware, trace). Derived artifacts
 * (drawings, quotes) store it; a different fingerprint means the artifact is stale.
 */
export function modelFingerprint(resolved: ResolvedCabinet): string {
  return hash53(
    stableStringify({
      trace: resolved.trace,
      components: resolved.components,
      hardwareRequirements: resolved.hardwareRequirements,
      hardwareResolutions: resolved.hardwareResolutions,
    }),
  );
}
