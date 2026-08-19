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
 * valid policy makes persisted grants authoritative; only the configured
 * self-hosted owner or a hosted Flags grant may create a new admission. An
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

      // Existing durable grants survive valid policy/provider changes and
      // hosted Flags outages.
      if (persisted.admitted) {
        return persisted;
      }

      if (policy.mode === "self-hosted") {
        if (
          normalizeInvitationEmail(entity.email ?? "") !==
          normalizeInvitationEmail(policy.bootstrapOwnerEmail)
        ) {
          return persisted;
        }

        const profile = await deps.accessProfiles.grantAccess({
          userId: entity.userId,
          source: "self_hosted_bootstrap",
        });
        return decisionFromProfile(profile);
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
