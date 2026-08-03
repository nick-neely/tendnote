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
 * Shared Private Beta Access logic. This module owns the bootstrap and admission
 * rules; the store only persists rows. Pages, server actions, and Eve ingress
 * should branch on the {@link AccessDecision} returned by `checkAccess` and never
 * derive access from "oldest user" queries beyond the one-time bootstrap.
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

  return {
    /**
     * Ensure a signed-up user has an access profile. The very first profile ever
     * created becomes the initial allowed owner (bootstrap); every later user
     * starts pending until access is granted.
     *
     * Bootstrap is atomic: we attempt the singular bootstrap insert and let the
     * store's uniqueness constraints decide the winner, so two concurrent first
     * signups cannot both be admitted.
     */
    async ensureAccessProfile(input: { userId: string }): Promise<AccessProfile> {
      const existing = await store.getByUserId(input.userId);

      if (existing) {
        return existing;
      }

      const bootstrapped = await store.insertIfAbsent({
        userId: input.userId,
        status: "granted",
        source: "bootstrap",
        grantedAt: new Date(),
      });

      if (bootstrapped) {
        return bootstrapped;
      }

      // The bootstrap is already taken, so this is a later signup: land pending.
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

    /**
     * Durably grant access to a user, recording where the grant came from. Used by
     * the bootstrap path, manual grants, and (later) beta-flag rollout. Upserts so
     * a pending user becomes granted and a brand-new user is created as granted.
     */
    async grantAccess(input: { userId: string; source: AccessSource }): Promise<AccessProfile> {
      const existing = await store.getByUserId(input.userId);
      const grantedAt = new Date();

      if (!existing) {
        return store.create({
          userId: input.userId,
          status: "granted",
          source: input.source,
          grantedAt,
        });
      }

      if (existing.status === "granted") {
        return existing;
      }

      const updated = await store.update({
        userId: input.userId,
        patch: { status: "granted", source: input.source, grantedAt },
      });

      if (!updated) {
        throw new Error("Failed to grant access profile.");
      }

      return updated;
    },
  };
}
