export type AiGatewayEnv = Record<string, string | undefined>;

/**
 * Whether this process can reach the AI Gateway at all. Every model-backed
 * extraction family asks the same question of the same two variables, so the
 * answer lives here rather than being restated beside each adapter - a family
 * that drifted to a third variable name would silently stop running.
 */
export function hasAiGatewayCredentials(env: AiGatewayEnv = process.env) {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

/** Fails with the purpose named, so a missing key is diagnosable from the message alone. */
export function requireAiGatewayCredentials(purpose: string, env: AiGatewayEnv = process.env) {
  if (!hasAiGatewayCredentials(env)) {
    throw new Error(
      `Missing AI Gateway credentials for ${purpose}. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.`,
    );
  }
}
