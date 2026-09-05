import { z } from "zod";

export const personUpdateFieldSchema = z.enum([
  "displayName",
  "firstName",
  "lastName",
  "birthday",
  "relationshipType",
  "closenessLevel",
  "profileBlurb",
]);
const valueSchema = z.union([z.string(), z.number(), z.null()]);
export const personUpdateChangeSchema = z.object({
  field: personUpdateFieldSchema,
  before: valueSchema,
  after: valueSchema,
});
export const personUpdateTargetSchema = z.object({ personId: z.uuid(), updateId: z.uuid() });
export const personUpdateSummarySchema = z.object({
  target: personUpdateTargetSchema,
  changes: z.array(personUpdateChangeSchema).min(1),
});
export const personUpdateUndoStatusSchema = z.enum([
  "applied",
  "already_undone",
  "superseded",
  "unavailable",
]);
export type PersonUpdateChange = z.infer<typeof personUpdateChangeSchema>;
export type PersonUpdateSummary = z.infer<typeof personUpdateSummarySchema>;
export type PersonUpdateTarget = z.infer<typeof personUpdateTargetSchema>;
export type PersonUpdateUndoStatus = z.infer<typeof personUpdateUndoStatusSchema>;

export type PersonUpdateStatus = "available" | Exclude<PersonUpdateUndoStatus, "applied">;
