import type { AccessProfile, AccessSource, SelfContextOnboardingStatus } from "@tendnote/domain";

export type {
  AccessDecision,
  AccessProfile,
  AccessSource,
  EveApprovalMode,
  SelfContextOnboardingState,
  SelfContextOnboardingStatus,
} from "@tendnote/domain";

/** Values handed to the store to insert a new access profile. */
export type PersistAccessProfileInput = {
  userId: string;
  status: AccessProfile["status"];
  source: AccessSource | null;
  grantedAt: Date | null;
  selfContextOnboardingStatus?: SelfContextOnboardingStatus;
  selfContextOnboardingReminderAt?: Date | null;
};

/** Defined-only fields the store may overwrite when updating a profile. */
export type AccessProfilePatch = Partial<
  Pick<
    AccessProfile,
    | "status"
    | "source"
    | "grantedAt"
    | "selfContextOnboardingStatus"
    | "selfContextOnboardingReminderAt"
    | "householdCheckinEnabled"
    | "eveApprovalMode"
  >
>;

/**
 * Storage seam for Tendnote-owned access profiles. The query layer owns the
 * bootstrap/admission rules; adapters only persist and read rows. Adapters must
 * enforce one profile per `userId`, and at most one profile for each singleton
 * bootstrap source (`bootstrap` for local development and
 * `self_hosted_bootstrap` for the configured production owner).
 */
export type AccessProfileStore = {
  getByUserId: (userId: string) => Promise<AccessProfile | null>;
  listByStatus: (status: AccessProfile["status"]) => Promise<AccessProfile[]>;
  /** Unconditional insert; used to create an explicitly-granted profile. */
  create: (input: PersistAccessProfileInput) => Promise<AccessProfile>;
  /**
   * Insert only if it violates no uniqueness constraint, returning `null` on
   * conflict instead of throwing. Used for singleton grants and idempotent
   * pending-profile creation.
   */
  insertIfAbsent: (input: PersistAccessProfileInput) => Promise<AccessProfile | null>;
  update: (input: { userId: string; patch: AccessProfilePatch }) => Promise<AccessProfile | null>;
  /** Atomically claims the one quiet later invitation for a dismissed owner. */
  claimSelfContextOnboardingReminder: (input: {
    userId: string;
    reminderAt: Date;
  }) => Promise<AccessProfile | null>;
};
