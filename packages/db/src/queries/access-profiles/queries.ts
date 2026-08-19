import {
  type AccessDecision,
  type AccessProfile,
  type AccessSource,
  type SelfContextOnboardingState,
  selfContextOnboardingStateSchema,
} from "@tendnote/domain";
import type { AccessProfileStore } from "./types";

function onboardingStateFromProfile(profile: AccessProfile): SelfContextOnboardingState {
  return selfContextOnboardingStateSchema.parse({
    status: profile.selfContextOnboardingStatus,
    reminderAt: profile.selfContextOnboardingReminderAt,
  });
}

/**
 * Shared Private Beta Access persistence. Admission policy is resolved by the
 * server boundary, while this module owns durable profile writes. Pages, server
 * actions, and Eve ingress should branch on the {@link AccessDecision} returned
 * by `checkAccess` and never derive access from user ordering.
 */
export function createAccessProfileQueries(store: AccessProfileStore) {
  async function updateSelfContextOnboarding(input: {
    userId: string;
    status: "completed" | "dismissed";
  }): Promise<SelfContextOnboardingState> {
    const existing = await store.getByUserId(input.userId);
    if (!existing) throw new Error("Failed to update Self Context setup.");
    if (existing.selfContextOnboardingStatus === "completed") {
      return onboardingStateFromProfile(existing);
    }

    const updated = await store.update({
      userId: input.userId,
      patch: { selfContextOnboardingStatus: input.status },
    });
    if (!updated) throw new Error("Failed to update Self Context setup.");
    return onboardingStateFromProfile(updated);
  }

  /** Durably grant one profile, preserving the source for audit and display. */
  async function grantAccess(input: {
    userId: string;
    source: AccessSource;
  }): Promise<AccessProfile> {
    const existing = await store.getByUserId(input.userId);
    const grantedAt = new Date();

    if (!existing) {
      const inserted = await store.insertIfAbsent({
        userId: input.userId,
        status: "granted",
        source: input.source,
        grantedAt,
      });

      if (inserted) {
        return inserted;
      }

      const settled = await store.getByUserId(input.userId);
      if (settled) {
        return settled.status === "granted" ? settled : grantExisting(settled, input.source);
      }

      // A singleton-source conflict belongs to another user. Keep this caller
      // pending instead of turning a uniqueness race into an admission error.
      const pending = await store.insertIfAbsent({
        userId: input.userId,
        status: "pending",
        source: null,
        grantedAt: null,
      });
      if (pending) return pending;

      const retry = await store.getByUserId(input.userId);
      if (!retry) throw new Error("Failed to grant access profile.");
      return retry.status === "granted" ? retry : grantExisting(retry, input.source);
    }

    if (existing.status === "granted") {
      return existing;
    }

    return grantExisting(existing, input.source);
  }

  return {
    /**
     * Turns this member's Household Check-in on or off (#390).
     *
     * The subject is the member and there is deliberately no argument for whose
     * Check-in this is: opting in is a decision only they can make, and a target
     * here would be the cross-member enrollment Phase Eight refuses (ADR 0220).
     *
     * The profile is ensured first so the control cannot succeed against
     * nothing. That is the whole reason this preference lives on the access
     * profile rather than beside the briefing it appears in: a member who has
     * never had a brief generated must still be able to ask for a Check-in.
     */
    async setHouseholdCheckinEnabled(input: {
      userId: string;
      enabled: boolean;
    }): Promise<boolean> {
      const existing = await store.getByUserId(input.userId);
      if (!existing) throw new Error("Failed to update the household check-in.");

      const updated = await store.update({
        userId: input.userId,
        patch: { householdCheckinEnabled: input.enabled },
      });
      if (!updated) throw new Error("Failed to update the household check-in.");
      return updated.householdCheckinEnabled;
    },

    /** Ensure a signed-up user has a pending profile without granting access. */
    async ensureAccessProfile(input: { userId: string }): Promise<AccessProfile> {
      const existing = await store.getByUserId(input.userId);

      if (existing) {
        return existing;
      }

      const pending = await store.insertIfAbsent({
        userId: input.userId,
        status: "pending",
        source: null,
        grantedAt: null,
      });

      if (pending) {
        return pending;
      }

      // A concurrent call for the same user won the insert; return that row.
      const settled = await store.getByUserId(input.userId);

      if (!settled) {
        throw new Error("Failed to ensure access profile.");
      }

      return settled;
    },

    /** Explicit local-only owner setup; production callers never use this path. */
    async ensureLocalDevelopmentAccessProfile(input: { userId: string }): Promise<AccessProfile> {
      return grantAccess({ userId: input.userId, source: "bootstrap" });
    },

    async getAccessProfile(input: { userId: string }): Promise<AccessProfile | null> {
      return store.getByUserId(input.userId);
    },

    async getSelfContextOnboardingState(input: {
      userId: string;
    }): Promise<SelfContextOnboardingState | null> {
      const profile = await store.getByUserId(input.userId);
      return profile ? onboardingStateFromProfile(profile) : null;
    },

    async completeSelfContextOnboarding(input: {
      userId: string;
    }): Promise<SelfContextOnboardingState> {
      return updateSelfContextOnboarding({ ...input, status: "completed" });
    },

    async dismissSelfContextOnboarding(input: {
      userId: string;
    }): Promise<SelfContextOnboardingState> {
      return updateSelfContextOnboarding({ ...input, status: "dismissed" });
    },

    async claimSelfContextOnboardingReminder(input: {
      userId: string;
    }): Promise<{ claimed: boolean; state: SelfContextOnboardingState | null }> {
      const claimed = await store.claimSelfContextOnboardingReminder({
        userId: input.userId,
        reminderAt: new Date(),
      });
      if (claimed) {
        return { claimed: true, state: onboardingStateFromProfile(claimed) };
      }

      const current = await store.getByUserId(input.userId);
      return {
        claimed: false,
        state: current ? onboardingStateFromProfile(current) : null,
      };
    },

    /**
     * The shared access-check seam. Returns admitted vs pending/denied without
     * loading any relationship data. A user with no profile is treated as pending.
     */
    async checkAccess(input: { userId: string }): Promise<AccessDecision> {
      const profile = await store.getByUserId(input.userId);

      if (!profile) {
        return { admitted: false, status: "pending", profile: null };
      }

      return {
        admitted: profile.status === "granted",
        status: profile.status,
        profile,
      };
    },

    /** Return only durable admitted principals for owner-scoped background work. */
    async listAdmittedOwnerUserIds(): Promise<string[]> {
      return (await store.listByStatus("granted")).map((profile) => profile.userId);
    },

    /** Durably grant access, preserving its admission source. */
    grantAccess,
  };

  async function grantExisting(
    existing: AccessProfile,
    source: AccessSource,
  ): Promise<AccessProfile> {
    let updated: AccessProfile | null;
    try {
      updated = await store.update({
        userId: existing.userId,
        patch: { status: "granted", source, grantedAt: new Date() },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      updated = null;
    }

    if (!updated) {
      // Another singleton grant won the race. Re-read the profile and leave it
      // pending if this user is still not admitted.
      const settled = await store.getByUserId(existing.userId);
      if (settled) return settled;
      throw new Error("Failed to grant access profile.");
    }

    return updated;
  }

  function isUniqueConstraintError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;

    const candidate = error as { code?: unknown; cause?: { code?: unknown } };
    return candidate.code === "23505" || candidate.cause?.code === "23505";
  }
}
