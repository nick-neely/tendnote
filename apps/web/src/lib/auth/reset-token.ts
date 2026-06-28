/**
 * Better Auth redirects the reset link to `redirectTo` with either `?token=…`
 * (valid) or `?error=INVALID_TOKEN` (invalid/expired). This resolves those query
 * params into the state the reset page renders. Pure so it can be unit tested.
 */
export type ResetTokenState = { state: "ready"; token: string } | { state: "invalid" };

export function resolveResetToken(params: {
  token?: string | null;
  error?: string | null;
}): ResetTokenState {
  if (params.error || !params.token) {
    return { state: "invalid" };
  }

  return { state: "ready", token: params.token };
}
