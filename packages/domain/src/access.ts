import { z } from "zod";

/**
 * Private Beta Access status for a Tendnote account/access profile.
 * Only `granted` admits a user into the product; everything else is pending/denied.
 */
export const accessStatusSchema = z.enum(["pending", "granted", "denied"]);

export type AccessStatus = z.infer<typeof accessStatusSchema>;

/** Explains where a granted access decision came from. */
export const accessSourceSchema = z.enum(["bootstrap", "manual_grant", "beta_flag"]);

export type AccessSource = z.infer<typeof accessSourceSchema>;

export const accessProfileSchema = z.object({
  userId: z.string(),
  status: accessStatusSchema,
  source: accessSourceSchema.nullable(),
  grantedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AccessProfile = z.infer<typeof accessProfileSchema>;

/**
 * Result of the shared access-check seam. `admitted` is the single signal pages,
 * server actions, and Eve ingress should branch on; it never loads relationship data.
 */
export type AccessDecision = {
  admitted: boolean;
  status: AccessStatus;
  profile: AccessProfile | null;
};
