type OwnerScopedContext = {
  session: { auth: { current?: { principalId?: string | null } | null } };
};

/**
 * Resolves the owner user id every Phase 1A tool scopes its writes to: the
 * authenticated principal, then a dev override, then a local demo fallback.
 * Shared so the derivation stays identical across tools (AGENTS.md: small
 * owner-scoped entry points).
 */
export function resolveOwnerUserId(ctx: OwnerScopedContext): string {
  const ownerUserId = ctx.session.auth.current?.principalId?.trim();

  if (!ownerUserId) {
    throw new Error("An authenticated Tendnote owner is required.");
  }

  return ownerUserId;
}
