import {
  type AccessDecision,
  type AccessProfile,
  type AccessSource,
  type AdmissionConfigurationDiagnostic,
  type AdmissionEnvironment,
  type AdmissionPolicy,
  normalizeInvitationEmail,
  parseAdmissionPolicy,
} from "@tendnote/domain";

/** The trusted Better Auth entity passed to admission evaluation. */
export type AdmissionEntity = { userId: string; email?: string | null };

/** Hosted Flags evaluation. Self-hosted policy never calls this function. */
export type HostedFlagEvaluator = (entity: AdmissionEntity) => Promise<boolean>;

/** The persisted access seam shared by Web and Eve. */
export type AccessProfileGateway = {
  checkAccess: (input: { userId: string }) => Promise<AccessDecision>;
  grantAccess: (input: { userId: string; source: AccessSource }) => Promise<AccessProfile>;
};

export type AdmissionResolverDependencies = {
  accessProfiles: AccessProfileGateway;
  evaluateFlag: HostedFlagEvaluator;
  policy?: AdmissionPolicy;
  environment?: AdmissionEnvironment;
  reportConfiguration?: (diagnostic: AdmissionConfigurationDiagnostic) => void;
};

function decisionFromProfile(profile: AccessProfile): AccessDecision {
  return { admitted: profile.status === "granted", status: profile.status, profile };
}

function pendingDecision(decision: AccessDecision): AccessDecision {
  return { admitted: false, status: "pending", profile: decision.profile };
}

function isSelfHostedGrant(decision: AccessDecision): boolean {
  return (
    decision.admitted &&
    (decision.profile?.source === "self_hosted_bootstrap" ||
      decision.profile?.source === "household_invitation")
  );
}

function diagnosticGuidance(diagnostic: AdmissionConfigurationDiagnostic): string {
  switch (diagnostic.code) {
    case "invalid_mode":
      return "set TENDNOTE_ADMISSION_MODE to hosted or self-hosted";
    case "missing_bootstrap_owner_email":
      return "set TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL to one valid address";
    case "invalid_bootstrap_owner_email":
      return "set TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL to exactly one valid address";
  }
}

/**
 * Resolve one request through the explicit policy and the durable profile. A
 * valid hosted policy makes every persisted grant authoritative. Self-hosted
 * policy narrows persisted authority to its own bootstrap and future invitation
 * provenance; legacy hosted/local grants remain durable for audit but resolve as
 * pending until the configured owner is upgraded to self-hosted provenance. An
 * invalid policy refuses every request before reading profile data.
 */
export function createAdmissionResolver(deps: AdmissionResolverDependencies) {
  const policy = deps.policy ?? parseAdmissionPolicy(deps.environment);
  let reportedInvalidConfiguration = false;

  function reportInvalidConfiguration() {
    if (policy.valid || reportedInvalidConfiguration) return;
    reportedInvalidConfiguration = true;
    (
      deps.reportConfiguration ??
      ((diagnostic) => {
        console.error(
          `[tendnote] invalid admission configuration (${diagnostic.code}); ${diagnosticGuidance(diagnostic)}; admission is disabled`,
        );
      })
    )(policy.diagnostic);
  }

  return {
    async resolveAccess(entity: AdmissionEntity): Promise<AccessDecision> {
      if (!policy.valid) {
        reportInvalidConfiguration();
        return { admitted: false, status: "pending", profile: null };
      }

      const persisted = await deps.accessProfiles.checkAccess({ userId: entity.userId });

      if (policy.mode === "self-hosted") {
        // A self-hosted deployment cannot inherit hosted/local admission. The
        // invitation source is already durable vocabulary for #475, so it stays
        // authoritative here without implementing invitation acceptance.
        if (isSelfHostedGrant(persisted)) {
          return persisted;
        }

        if (
          normalizeInvitationEmail(entity.email ?? "") !==
          normalizeInvitationEmail(policy.bootstrapOwnerEmail)
        ) {
          return pendingDecision(persisted);
        }

        const profile = await deps.accessProfiles.grantAccess({
          userId: entity.userId,
          source: "self_hosted_bootstrap",
        });
        const decision = decisionFromProfile(profile);
        return profile.source === "self_hosted_bootstrap" ? decision : pendingDecision(decision);
      }

      // Existing durable grants survive hosted provider changes and Flags
      // outages; hosted mode deliberately retains the prior authority contract.
      if (persisted.admitted) {
        return persisted;
      }

      let granted = false;
      try {
        granted = await deps.evaluateFlag(entity);
      } catch {
        // Hosted Flags is fail-closed for users without a persisted grant.
        return persisted;
      }

      if (!granted) {
        return persisted;
      }

      const profile = await deps.accessProfiles.grantAccess({
        userId: entity.userId,
        source: "beta_flag",
      });
      return decisionFromProfile(profile);
    },
  };
}
