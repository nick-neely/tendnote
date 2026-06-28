import type { AccessDecision, AccessProfile, AccessSource } from "@tendnote/domain";

/** The trusted user entity passed to Private Beta Access evaluation. */
export type BetaFlagEntity = { userId: string; email?: string | null };

/**
 * Evaluates the Private Beta Access flag for a user entity. Implementations may
 * throw when the flag provider is unavailable; the resolver treats a throw as a
 * fail-closed signal (no admission unless persisted access already exists).
 */
export type PrivateBetaFlagEvaluator = (entity: BetaFlagEntity) => Promise<boolean>;

/** The persisted access seam from #84, narrowed to what the resolver needs. */
export type AccessProfileGateway = {
  checkAccess: (input: { userId: string }) => Promise<AccessDecision>;
  grantAccess: (input: { userId: string; source: AccessSource }) => Promise<AccessProfile>;
};

/**
 * Resolves durable Private Beta Access by combining persisted access (#84) with
 * server-side Vercel Flags evaluation (#85). Persisted access is authoritative:
 * an already-admitted user stays admitted regardless of the flag, and a
 * flag-granted user is persisted so admission survives later flag failures.
 */
export function createPrivateBetaAccessResolver(deps: {
  accessProfiles: AccessProfileGateway;
  evaluateFlag: PrivateBetaFlagEvaluator;
}) {
  return {
    async resolveAccess(entity: BetaFlagEntity): Promise<AccessDecision> {
      const persisted = await deps.accessProfiles.checkAccess({ userId: entity.userId });

      // Persisted admission never depends on the flag (bootstrap, manual grant,
      // or a prior flag grant), so it short-circuits before any evaluation.
      if (persisted.admitted) {
        return persisted;
      }

      let granted = false;

      try {
        granted = await deps.evaluateFlag(entity);
      } catch {
        // Fail closed: an unavailable flag provider must not admit a user who has
        // no persisted access.
        return persisted;
      }

      if (!granted) {
        return persisted;
      }

      // Durably admit the flag-granted user so access does not depend on the flag
      // provider remaining reachable on the next request.
      const profile = await deps.accessProfiles.grantAccess({
        userId: entity.userId,
        source: "beta_flag",
      });

      return { admitted: profile.status === "granted", status: profile.status, profile };
    },
  };
}
