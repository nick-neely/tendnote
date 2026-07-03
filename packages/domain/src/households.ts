import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

export const householdRoleSchema = z.enum(["owner", "member"]);
export type HouseholdRole = z.infer<typeof householdRoleSchema>;

export const householdMemberStatusSchema = z.enum(["invited", "active", "removed"]);
export type HouseholdMemberStatus = z.infer<typeof householdMemberStatusSchema>;

export const householdWorkspaceSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  name: z.string().min(1),
  defaultScope: privacyScopeSchema.default("private"),
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
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type HouseholdMembership = z.infer<typeof householdMembershipSchema>;

export const createHouseholdWorkspaceSchema = householdWorkspaceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateHouseholdWorkspaceInput = z.infer<typeof createHouseholdWorkspaceSchema>;

export const createHouseholdMembershipSchema = householdMembershipSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateHouseholdMembershipInput = z.infer<typeof createHouseholdMembershipSchema>;

export function assertHouseholdOwner(membership: Pick<HouseholdMembership, "role" | "status">) {
  if (membership.status !== "active" || membership.role !== "owner") {
    throw new Error("Household owner permissions required.");
  }
}
