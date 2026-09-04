import { createDrizzleAccessProfileStore } from "./access-profiles/drizzle-store";
import { createAccessProfileQueries } from "./access-profiles/queries";
import type { AccessSource, EveApprovalMode } from "./access-profiles/types";

export type {
  AccessProfileGateway,
  AdmissionEntity,
  AdmissionResolverDependencies,
  HostedFlagEvaluator,
} from "./access-profiles/admission";
export { createAdmissionResolver } from "./access-profiles/admission";
export { createDrizzleAccessProfileStore } from "./access-profiles/drizzle-store";
export { createInMemoryAccessProfileStore } from "./access-profiles/in-memory-store";
export { createAccessProfileQueries } from "./access-profiles/queries";
export type * from "./access-profiles/types";

const defaultAccessProfileQueries = createAccessProfileQueries(createDrizzleAccessProfileStore());

export async function ensureAccessProfile(input: { userId: string }) {
  return defaultAccessProfileQueries.ensureAccessProfile(input);
}

/** Local development only: explicitly grant the configured demo owner. */
export async function ensureLocalDevelopmentAccessProfile(input: { userId: string }) {
  return defaultAccessProfileQueries.ensureLocalDevelopmentAccessProfile(input);
}

export async function getAccessProfile(input: { userId: string }) {
  return defaultAccessProfileQueries.getAccessProfile(input);
}

/**
 * The member's own Household Check-in opt-in. Owner-scoped: the signed-in member
 * is the subject, and there is no form of this that names anybody else.
 */
export async function setHouseholdCheckinEnabled(input: { userId: string; enabled: boolean }) {
  return defaultAccessProfileQueries.setHouseholdCheckinEnabled(input);
}

/**
 * This user's Approval Mode for Eve's gated tool calls. Owner-scoped: the
 * signed-in user is the subject, and there is no form of this that names anybody
 * else (#549).
 */
export async function setEveApprovalMode(input: { userId: string; mode: EveApprovalMode }) {
  return defaultAccessProfileQueries.setEveApprovalMode(input);
}

/**
 * The Approval Mode the policy reads on each gated call. A user with no profile
 * reads `ask`, the same answer a failed read must produce.
 */
export async function getEveApprovalMode(input: { userId: string }) {
  return defaultAccessProfileQueries.getEveApprovalMode(input);
}

export async function getSelfContextOnboardingState(input: { userId: string }) {
  return defaultAccessProfileQueries.getSelfContextOnboardingState(input);
}

export async function completeSelfContextOnboarding(input: { userId: string }) {
  return defaultAccessProfileQueries.completeSelfContextOnboarding(input);
}

export async function dismissSelfContextOnboarding(input: { userId: string }) {
  return defaultAccessProfileQueries.dismissSelfContextOnboarding(input);
}

export async function claimSelfContextOnboardingReminder(input: { userId: string }) {
  return defaultAccessProfileQueries.claimSelfContextOnboardingReminder(input);
}

export async function checkAccess(input: { userId: string }) {
  return defaultAccessProfileQueries.checkAccess(input);
}

export async function listAdmittedOwnerUserIds() {
  return defaultAccessProfileQueries.listAdmittedOwnerUserIds();
}

export async function grantAccess(input: { userId: string; source: AccessSource }) {
  return defaultAccessProfileQueries.grantAccess(input);
}
