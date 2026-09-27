import type { CatalogSnapshot, DesignObject, ParameterSource, ProductDefinition, ResolvedParameters, ScalarValue, ValidationMessage } from "@lintel/types";
import { enumFlag, findAppliance, findFinish, findMaterial } from "@lintel/catalog-engine";

const DIMENSION_KEYS = ["width", "height", "depth"] as const;

export interface ParameterResolution {
  readonly parameters: ResolvedParameters;
  /** Formula scope contributed by parameters. Invalid parameters are omitted, so dependants fail loudly. */
  readonly scope: Readonly<Record<string, ScalarValue>>;
  readonly messages: readonly ValidationMessage[];
}

/**
 * Resolve an object's parameters against its product definition (PRD §13):
 * defaults → object overrides → type/limit checks. Dimensions come only from
 * `object.dimensions`. Pure.
 */
export function resolveParameters(product: ProductDefinition, object: DesignObject, catalog: CatalogSnapshot): ParameterResolution {
  const messages: ValidationMessage[] = [];
  const values: Record<string, number | string> = {};
  const provenance: Record<string, ParameterSource> = {};
  const scope: Record<string, ScalarValue> = {};
  const known = new Set(product.parameters.map((p) => p.key));
  const src = object.objectId;

  const block = (code: string, key: string, message: string): void => {
    messages.push({ code, severity: "BLOCKER", message, path: `parameters.${key}`, sourceObjectId: src });
  };

  for (const key of Object.keys(object.parameters).sort()) {
    if ((DIMENSION_KEYS as readonly string[]).includes(key)) {
      messages.push({ code: "PARAMETER_DUPLICATES_DIMENSION", severity: "ERROR", message: `'${key}' must be set in dimensions, not parameters; the parameters value is ignored`, path: `parameters.${key}`, sourceObjectId: src });
    } else if (!known.has(key)) {
      messages.push({ code: "PARAMETER_UNKNOWN", severity: "ERROR", message: `Parameter '${key}' is not defined for ${product.productId}; ignored`, path: `parameters.${key}`, sourceObjectId: src });
    }
  }

  for (const def of product.parameters) {
    const isDim = (DIMENSION_KEYS as readonly string[]).includes(def.key);
    const supplied: unknown = isDim ? object.dimensions[def.key as (typeof DIMENSION_KEYS)[number]] : object.parameters[def.key];
    const value: unknown = supplied ?? def.default;
    provenance[def.key] = supplied === undefined ? "DEFAULT" : "OBJECT";

    switch (def.kind) {
      case "number":
      case "integer": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          block("PARAMETER_INVALID_TYPE", def.key, `${def.label} must be a finite number`);
          continue;
        }
        if (def.kind === "integer" && !Number.isInteger(value)) {
          block("PARAMETER_INVALID_TYPE", def.key, `${def.label} must be an integer (got ${value})`);
          continue;
        }
        values[def.key] = value;
        if ((def.min !== null && value < def.min) || (def.max !== null && value > def.max)) {
          block("PARAMETER_OUT_OF_RANGE", def.key, `${def.label} ${value} is outside ${def.min ?? "−∞"}–${def.max ?? "∞"}`);
          continue;
        }
        if (def.kind === "integer" && def.allowed !== null && !def.allowed.includes(value)) {
          block("PARAMETER_NOT_ALLOWED", def.key, `${def.label} ${value} is not one of ${def.allowed.join(", ")}`);
          continue;
        }
        scope[def.symbol] = value;
        break;
      }
      case "enum": {
        if (typeof value !== "string" || !def.values.includes(value)) {
          block("PARAMETER_NOT_ALLOWED", def.key, `${def.label} must be one of ${def.values.join(", ")} (got ${String(value)})`);
          continue;
        }
        values[def.key] = value;
        for (const v of def.values) scope[enumFlag(def.symbol, v)] = v === value;
        break;
      }
      case "material": {
        const material = typeof value === "string" ? findMaterial(catalog, value) : undefined;
        if (material === undefined) {
          block("MATERIAL_UNKNOWN", def.key, `${def.label} '${String(value)}' is not in catalog ${catalog.catalogVersion}`);
          continue;
        }
        values[def.key] = material.materialId;
        scope[def.symbol] = material.thickness;
        break;
      }
      case "finish": {
        const finish = typeof value === "string" ? findFinish(catalog, value) : undefined;
        if (finish === undefined) {
          block("FINISH_UNKNOWN", def.key, `${def.label} '${String(value)}' is not in catalog ${catalog.catalogVersion}`);
          continue;
        }
        values[def.key] = finish.finishId;
        break;
      }
      case "appliance": {
        const appliance = typeof value === "string" ? findAppliance(catalog, value) : undefined;
        if (appliance === undefined) {
          block("APPLIANCE_UNKNOWN", def.key, `${def.label} '${String(value)}' is not in catalog ${catalog.catalogVersion}`);
          continue;
        }
        if (appliance.installation === null) {
          block("APPLIANCE_INSTALLATION_UNVERIFIED", def.key, `${def.label} '${appliance.applianceId}' has no installation envelope yet (NULL / UNVERIFIED)`);
          continue;
        }
        values[def.key] = appliance.applianceId;
        scope[`${def.symbol}_W`] = appliance.installation.widthMm;
        scope[`${def.symbol}_H`] = appliance.installation.heightMm;
        scope[`${def.symbol}_D`] = appliance.installation.depthMm;
        break;
      }
    }
  }
  return { parameters: { values, provenance }, scope, messages };
}
