import type { AccessProfile, AccessSource } from "@tendnote/domain";

export type { AccessDecision, AccessProfile, AccessSource } from "@tendnote/domain";

/** Values handed to the store to insert a new access profile. */
export type PersistAccessProfileInput = {
  userId: string;
  status: AccessProfile["status"];
  source: AccessSource | null;
  grantedAt: Date | null;
};

/** Defined-only fields the store may overwrite when updating a profile. */
export type AccessProfilePatch = Partial<Pick<AccessProfile, "status" | "source" | "grantedAt">>;

/**
 * Storage seam for Tendnote-owned access profiles. The query layer owns the
 * bootstrap/admission rules; adapters only persist and read rows. Adapters must
 * enforce two uniqueness constraints so bootstrap is race-safe: one profile per
 * `userId`, and at most one profile with `source: "bootstrap"`.
 */
export type AccessProfileStore = {
  getByUserId: (userId: string) => Promise<AccessProfile | null>;
  listByStatus: (status: AccessProfile["status"]) => Promise<AccessProfile[]>;
  /** Unconditional insert; used to create an explicitly-granted profile. */
  create: (input: PersistAccessProfileInput) => Promise<AccessProfile>;
  /**
   * Insert only if it violates no uniqueness constraint, returning `null` on
   * conflict instead of throwing. Used for the atomic first-user bootstrap and
   * for idempotent pending-profile creation.
   */
  insertIfAbsent: (input: PersistAccessProfileInput) => Promise<AccessProfile | null>;
  update: (input: { userId: string; patch: AccessProfilePatch }) => Promise<AccessProfile | null>;
};
