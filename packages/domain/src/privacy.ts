import { z } from "zod";

export const privacyScopeSchema = z.enum(["private", "shared", "household"]);
export type PrivacyScope = z.infer<typeof privacyScopeSchema>;

export const sensitivitySchema = z.enum(["normal", "sensitive", "private"]);
export type Sensitivity = z.infer<typeof sensitivitySchema>;

export const confidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const sourceSchema = z.enum([
  "manual",
  "agent",
  "contact_import",
  "calendar",
  "gmail",
  "seed",
]);
export type Source = z.infer<typeof sourceSchema>;

export function canUseMemoryInBrief(input: {
  sensitivity: Sensitivity;
  directlyRequested?: boolean;
}) {
  return input.sensitivity === "normal" || input.directlyRequested === true;
}
