/** Evaluation context for Private Beta Access — a stable user id and email. */
export type PrivateBetaUser = { id: string; email?: string };

function betaEmailAllowlist(): Set<string> {
  return new Set(
    (process.env.TENDNOTE_PRIVATE_BETA_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The base Private Beta Access decision. Vercel Flags Explorer overrides and
 * dashboard-managed segments layer on top of this at runtime; this env allowlist
 * is the deterministic default when no override is present. Kept free of
 * server-only/request imports so it can be unit tested directly.
 */
export function decidePrivateBetaAccess(user: PrivateBetaUser | undefined): boolean {
  if (!user?.email) {
    return false;
  }

  return betaEmailAllowlist().has(user.email.toLowerCase());
}
