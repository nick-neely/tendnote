import type { AccessProfile } from "@tendnote/domain";
import type { AccessProfileStore } from "./types";

export function createInMemoryAccessProfileStore(seed: AccessProfile[] = []): AccessProfileStore {
  const profiles = new Map(seed.map((profile) => [profile.userId, profile]));

  function insert(input: Parameters<AccessProfileStore["create"]>[0]): AccessProfile {
    const now = new Date();
    const profile: AccessProfile = {
      userId: input.userId,
      status: input.status,
      source: input.source,
      grantedAt: input.grantedAt,
      selfContextOnboardingStatus: input.selfContextOnboardingStatus ?? "not_started",
      selfContextOnboardingReminderAt: input.selfContextOnboardingReminderAt ?? null,
      householdCheckinEnabled: false,
      createdAt: now,
      updatedAt: now,
    };

    profiles.set(profile.userId, profile);

    return profile;
  }

  function hasConflict(input: Parameters<AccessProfileStore["create"]>[0]): boolean {
    // Mirror the DB constraints: one profile per user and one row for each
    // singleton bootstrap source.
    if (profiles.has(input.userId)) {
      return true;
    }

    return (
      (input.source === "bootstrap" || input.source === "self_hosted_bootstrap") &&
      [...profiles.values()].some((profile) => profile.source === input.source)
    );
  }

  return {
    async getByUserId(userId) {
      return profiles.get(userId) ?? null;
    },

    async listByStatus(status) {
      return [...profiles.values()]
        .filter((profile) => profile.status === status)
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.userId.localeCompare(right.userId),
        );
    },

    async create(input) {
      return insert(input);
    },

    async insertIfAbsent(input) {
      if (hasConflict(input)) {
        return null;
      }

      return insert(input);
    },

    async update({ userId, patch }) {
      const existing = profiles.get(userId);

      if (!existing) {
        return null;
      }

      if (
        (patch.source === "bootstrap" || patch.source === "self_hosted_bootstrap") &&
        [...profiles.values()].some(
          (profile) => profile.userId !== userId && profile.source === patch.source,
        )
      ) {
        return null;
      }

      const updated: AccessProfile = { ...existing, ...patch, updatedAt: new Date() };
      profiles.set(userId, updated);

      return updated;
    },

    async claimSelfContextOnboardingReminder({ userId, reminderAt }) {
      const existing = profiles.get(userId);

      if (
        existing?.selfContextOnboardingStatus !== "dismissed" ||
        existing.selfContextOnboardingReminderAt !== null
      ) {
        return null;
      }

      const updated: AccessProfile = {
        ...existing,
        selfContextOnboardingReminderAt: reminderAt,
        updatedAt: new Date(),
      };
      profiles.set(userId, updated);

      return updated;
    },
  };
}
