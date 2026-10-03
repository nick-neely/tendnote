import {
  type AccessDecision,
  type AccessProfile,
  type AccessSource,
  type AdmissionBlock,
  type AdmissionConfigurationDiagnostic,
  type AdmissionEnvironment,
  type AdmissionPolicy,
  decideAdmission,
  normalizeInvitationEmail,
  parseAdmissionPolicy,
} from "@tendnote/domain";

/**
 * The trusted Better Auth entity passed to admission evaluation. `emailVerified`
 * reflects the session user's verified-ownership flag; the self-hosted bootstrap
 * grant requires it to be `true`, so a value of `undefined`/`false` fails closed.
 */
export type AdmissionEntity = { userId: string; email?: string | null; emailVerified?: boolean };

/** Hosted Flags evaluation. Self-hosted policy never calls this function. */
export type HostedFlagEvaluator = (entity: AdmissionEntity) => Promise<boolean>;

/** The persisted access seam shared by Web and Eve. */
export type AccessProfileGateway = {
  checkAccess: (input: { userId: string }) => Promise<AccessDecision>;
  grantAccess: (input: { userId: string; source: AccessSource }) => Promise<AccessProfile>;
};

/**
 * Reads a user's active admission blocks, each with the exception records that
 * name it. It must be a local read of Tendnote's own records and never call a
 * provider such as Stripe on the request path.
 */
export type AdmissionBlockReader = (input: {
  userId: string;
}) => Promise<readonly AdmissionBlock[]>;

/**
 * Reads the household a user is an active member of, with that household's
 * active Owners, or `null` when they have none. A local read, like blocks.
 */
export type GuestHousehold = { householdId: string; ownerUserIds: readonly string[] };

export type GuestHouseholdReader = (input: { userId: string }) => Promise<GuestHousehold | null>;

/**
 * What an account's memberships say about a guest view it no longer has
 * (#637): it still holds a non-Owner membership (`household_inactive`), or it
 * held one that ended (`membership_ended`). Membership facts only; whether the
 * household is actually without a paying Owner is the admission reader's call.
 */
export type GuestStanding = "household_inactive" | "membership_ended";

export type GuestStandingReader = (input: { userId: string }) => Promise<GuestStanding | null>;

export type AdmissionResolverDependencies = {
  accessProfiles: AccessProfileGateway;
  evaluateFlag: HostedFlagEvaluator;
  /** No block records exist yet, so the default reads none. */
  listAdmissionBlocks?: AdmissionBlockReader;
  /** Hosted only. Without it nobody resolves as a Household Guest. */
  readGuestHousehold?: GuestHouseholdReader;
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

type LocalAdmissionDependencies = {
  accessProfiles: Pick<AccessProfileGateway, "checkAccess">;
  listAdmissionBlocks?: AdmissionBlockReader;
  readGuestHousehold?: GuestHouseholdReader;
  /** Hosted only. Without it no account has a {@link GuestStanding}. */
  readGuestStanding?: GuestStandingReader;
  policy?: AdmissionPolicy;
  environment?: AdmissionEnvironment;
};

/**
 * Admission answered from Tendnote's own records alone: durable grants,
 * blocks, and household membership. It never evaluates Flags or grants
 * anything, so it can describe accounts other than the requester's, such as a
 * guest's Owners or the members a household roster lists.
 */
export function createLocalAdmissionReader(deps: LocalAdmissionDependencies) {
  const policy = deps.policy ?? parseAdmissionPolicy(deps.environment);
  const listAdmissionBlocks: AdmissionBlockReader = deps.listAdmissionBlocks ?? (async () => []);

  async function isUnblocked(userId: string): Promise<boolean> {
    return decideAdmission({ sourceAdmits: true, blocks: await listAdmissionBlocks({ userId }) });
  }

  /** A durable grant this policy honours, with no unexcepted block. */
  async function holdsFullAdmission(userId: string): Promise<boolean> {
    if (!policy.valid) return false;
    const persisted = await deps.accessProfiles.checkAccess({ userId });
    const sourceAdmits =
      policy.mode === "self-hosted" ? isSelfHostedGrant(persisted) : persisted.admitted;
    return sourceAdmits && (await isUnblocked(userId));
  }

  /**
   * The household this account is a live Household Guest of, if any (ADR
   * 0245). Hosted only. It is live while at least one active Owner of the
   * household holds Paid Access, read on every call and never cached, so the
   * guest collapses and returns on the next request after the last such Owner
   * does. Any block on that Owner, such as a lapse or suspension, ends their
   * sponsorship too, and the guest's own blocks still apply. An account that
   * has held Paid Access is never a guest: once that ends it is Lapsed, which a
   * household roster states as "not currently admitted".
   */
  /** A sponsor: Paid Access the policy honours, with no unexcepted block. */
  async function holdsPaidAccess(userId: string): Promise<boolean> {
    const persisted = await deps.accessProfiles.checkAccess({ userId });
    return (
      persisted.admitted &&
      persisted.profile?.source === "paid_access" &&
      (await isUnblocked(userId))
    );
  }

  async function liveGuestHousehold(userId: string): Promise<{ householdId: string } | null> {
    if (policy.mode !== "hosted" || !deps.readGuestHousehold) return null;
    // Household Guest is entered only from Unpaid. An account that has held
    // Paid Access is Lapsed once it ends, never a guest.
    if ((await deps.accessProfiles.checkAccess({ userId })).profile?.source === "paid_access") {
      return null;
    }
    const household = await deps.readGuestHousehold({ userId });
    if (!household) return null;

    for (const ownerUserId of household.ownerUserIds) {
      if (ownerUserId !== userId && (await holdsPaidAccess(ownerUserId))) {
        return (await isUnblocked(userId)) ? { householdId: household.householdId } : null;
      }
    }
    return null;
  }

  /**
   * Why a hosted account that is not a live Household Guest, and never held
   * Paid Access, lost a guest view it had (#637): its household lost its last
   * paying Owner, or its membership ended. An account blocked on its own
   * account has no standing here, because its household may well be paying.
   */
  async function guestStanding(userId: string): Promise<GuestStanding | null> {
    if (policy.mode !== "hosted" || !deps.readGuestStanding) return null;
    if ((await deps.accessProfiles.checkAccess({ userId })).profile?.source === "paid_access") {
      return null;
    }
    if (!(await isUnblocked(userId)) || (await liveGuestHousehold(userId))) return null;
    return deps.readGuestStanding({ userId });
  }

  return {
    liveGuestHousehold,
    guestStanding,
    /**
     * Whether the account is admitted now, fully or as a live guest. This is
     * what a household roster states about a member, and nothing more.
     */
    async isCurrentlyAdmitted(input: { userId: string }): Promise<boolean> {
      return (
        (await holdsFullAdmission(input.userId)) ||
        (await liveGuestHousehold(input.userId)) !== null
      );
    },
  };
}

/**
 * Resolve one request as "at least one source admits and no unexcepted block is
 * active" (ADR 0248). Sources resolve through the explicit policy and the
 * durable profile: a valid hosted policy makes every persisted grant
 * authoritative. Self-hosted policy narrows persisted authority to its own
 * bootstrap and invitation provenance; legacy hosted/local grants remain durable
 * for audit but resolve as pending until the configured owner is upgraded to
 * self-hosted provenance. An invalid policy refuses every request before reading
 * profile data. Blocks are read only once a source admits.
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

  const listAdmissionBlocks: AdmissionBlockReader = deps.listAdmissionBlocks ?? (async () => []);
  const localAdmission = createLocalAdmissionReader({ ...deps, policy });

  async function resolveSources(entity: AdmissionEntity): Promise<AccessDecision> {
    if (!policy.valid) {
      reportInvalidConfiguration();
      return { admitted: false, status: "pending", profile: null };
    }

    const persisted = await deps.accessProfiles.checkAccess({ userId: entity.userId });

    if (policy.mode === "self-hosted") {
      // A self-hosted deployment cannot inherit hosted/local admission. The
      // Invitation acceptance persists this source in the same transaction as
      // the membership, so it remains authoritative here as well.
      if (isSelfHostedGrant(persisted)) {
        return persisted;
      }

      if (
        normalizeInvitationEmail(entity.email ?? "") !==
        normalizeInvitationEmail(policy.bootstrapOwnerEmail)
      ) {
        return pendingDecision(persisted);
      }

      // Verified email ownership is required before the durable owner role is
      // granted. Public credential signup issues a session with an unverified
      // email, so an attacker who registers the configured owner address first
      // (without controlling the mailbox) matches on email here but must not
      // receive the owner role. Fail closed until the owner proves ownership.
      if (entity.emailVerified !== true) {
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
  }

  return {
    async resolveAccess(entity: AdmissionEntity): Promise<AccessDecision> {
      const sourceDecision = await resolveSources(entity);
      if (!sourceDecision.admitted) {
        // Hosted acceptance creates a membership, not a grant, so a guest is
        // derived here on every request rather than stored.
        const guest = await localAdmission.liveGuestHousehold(entity.userId);
        return guest ? { ...sourceDecision, guest } : sourceDecision;
      }

      const blocks = await listAdmissionBlocks({ userId: entity.userId });
      return decideAdmission({ sourceAdmits: true, blocks })
        ? sourceDecision
        : { admitted: false, status: "denied", profile: sourceDecision.profile };
    },
  };
}
