import { z } from "zod";

/** Millimetres as stored (numeric(10,2)): finite, at most two decimals, below 10^8. */
export const Millimetres = z.number().refine((v) => Math.abs(v) < 1e8 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "millimetres with at most two decimals");
export const PositiveMillimetres = Millimetres.refine((v) => v > 0, "must be greater than 0");
export const NonNegativeMillimetres = Millimetres.refine((v) => v >= 0, "must not be negative");
