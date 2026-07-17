type OwnerScopedContext = {
  session: { auth: { current?: { principalId?: string | null } | null } };
};

/**
 * Resolves the owner user id every Phase 1A tool scopes its writes to: the
 * authenticated Eve session principal. Hosted auth and loopback-only local
 * owner mapping both terminate at the channel boundary, so tools never infer
 * or invent an owner. Shared so the derivation stays identical across tools
 * (AGENTS.md: small owner-scoped entry points).
 */
export function resolveOwnerUserId(ctx: OwnerScopedContext): string {
  const ownerUserId = ctx.session.auth.current?.principalId?.trim();

  if (!ownerUserId) {
    throw new Error("An authenticated Tendnote owner is required.");
  }

  return ownerUserId;
}
