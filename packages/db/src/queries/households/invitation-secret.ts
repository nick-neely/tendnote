import { createHash, randomBytes } from "node:crypto";

/**
 * 256 bits of randomness, base64url-encoded so it survives a URL path segment
 * untouched. This is the conservative implementation target for an emailed URL
 * token (OWASP Forgot Password Cheat Sheet, URL tokens): long enough that
 * guessing is not a threat model worth designing around.
 */
const SECRET_BYTES = 32;

export type HouseholdInvitationSecret = {
  /** Emailed once, never stored, never logged, never written to an audit row. */
  secret: string;
  /** What the database holds, and the only thing a lookup is done by. */
  digest: string;
};

export function mintHouseholdInvitationSecret(): HouseholdInvitationSecret {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return { secret, digest: digestHouseholdInvitationSecret(secret) };
}

/**
 * The one-way mapping from a presented secret to the stored column.
 *
 * A plain SHA-256 is deliberate rather than a password hash: the input is 256
 * bits of uniform randomness, so there is no dictionary to slow down, and the
 * lookup has to be a single indexed equality against `secret_digest` for the
 * acceptance path to stay one query.
 */
export function digestHouseholdInvitationSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
