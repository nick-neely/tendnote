import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

export const householdRoleSchema = z.enum(["owner", "member"]);
export type HouseholdRole = z.infer<typeof householdRoleSchema>;

export const householdMemberStatusSchema = z.enum(["invited", "active", "removed"]);
export type HouseholdMemberStatus = z.infer<typeof householdMemberStatusSchema>;

/**
 * Whether a Household Workspace is still a place its members can be in.
 *
 * A `dissolved` workspace keeps its row through the recovery window rather than
 * disappearing at the moment it ends, so this — not the row's existence — is
 * what says a household is over.
 */
export const householdStatusSchema = z.enum(["active", "dissolved"]);
export type HouseholdStatus = z.infer<typeof householdStatusSchema>;

export const householdWorkspaceSchema = z.object({
  id: z.string(),
  /** Who created it. History, not authority: co-owners govern jointly. */
  ownerUserId: z.string(),
  name: z.string().min(1),
  defaultScope: privacyScopeSchema.default("private"),
  status: householdStatusSchema.default("active"),
  dissolvedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type HouseholdWorkspace = z.infer<typeof householdWorkspaceSchema>;

export const householdMembershipSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  userId: z.string(),
  invitedByUserId: z.string(),
  role: householdRoleSchema,
  status: householdMemberStatusSchema,
  invitedAt: z.date(),
  acceptedAt: z.date().nullable().default(null),
  removedAt: z.date().nullable().default(null),
  /**
   * A role this person has been offered and has not answered yet.
   *
   * It sits beside `role` rather than replacing it because an unanswered offer
   * changes nothing about what someone may do: promotion to co-owner takes the
   * recipient's acceptance (ADR 0213), so the offer is a question the membership
   * is carrying, not an early version of the answer. One membership holds at
   * most one live offer, which is why this is a column rather than a table.
   */
  pendingRole: householdRoleSchema.nullable().default(null),
  pendingRoleOfferedByUserId: z.string().nullable().default(null),
  pendingRoleOfferedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type HouseholdMembership = z.infer<typeof householdMembershipSchema>;

/** A household is only ever created active; ending one is a governance transition. */
export const createHouseholdWorkspaceSchema = householdWorkspaceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  dissolvedAt: true,
});
export type CreateHouseholdWorkspaceInput = z.infer<typeof createHouseholdWorkspaceSchema>;

/**
 * A membership is never created carrying an offer. Promotion is a governance
 * transition applied to a membership that already exists, so the offer columns
 * are omitted here rather than defaulted: there is no shape of create input that
 * can smuggle one in.
 */
export const createHouseholdMembershipSchema = householdMembershipSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  pendingRole: true,
  pendingRoleOfferedByUserId: true,
  pendingRoleOfferedAt: true,
});
export type CreateHouseholdMembershipInput = z.infer<typeof createHouseholdMembershipSchema>;

export function assertHouseholdOwner(membership: Pick<HouseholdMembership, "role" | "status">) {
  if (membership.status !== "active" || membership.role !== "owner") {
    throw new Error("Household owner permissions required.");
  }
}
