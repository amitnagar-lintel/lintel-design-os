import type { PipeTransform } from "@nestjs/common";
import type { FieldError } from "../errors/api-problem.js";
import { ApiProblem } from "../errors/api-problem.js";

/** The Standard Schema v1 interface (https://standardschema.dev), implemented by Zod 4 and other libraries. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}
type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string; readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined }[] };

export type Location = "body" | "query" | "params" | "headers";

/** Validate one request part against a Standard Schema; failures become VALIDATION_FAILED with field errors. */
export async function validate<O>(schema: StandardSchemaV1<unknown, O>, value: unknown, location: Location): Promise<O> {
  const result = await schema["~standard"].validate(value);
  if (result.issues === undefined) return result.value;
  const errors: FieldError[] = result.issues.map((i) => ({
    path: [location, ...(i.path ?? []).map((p) => String(typeof p === "object" ? p.key : p))].join("."),
    code: "invalid",
    message: i.message,
  }));
  throw new ApiProblem("VALIDATION_FAILED", undefined, { errors });
}

/** `@Body(new SchemaPipe(Schema, "body"))`: controllers never validate by hand. */
export class SchemaPipe<O> implements PipeTransform<unknown, Promise<O>> {
  constructor(private readonly schema: StandardSchemaV1<unknown, O>, private readonly location: Location) {}
  transform(value: unknown): Promise<O> {
    return validate(this.schema, value, this.location);
  }
}
