import { type BetterAuthOptions, betterAuth } from "better-auth";

const LOCAL_BETTER_AUTH_SECRET = "tendnote-local-dev-secret-change-before-production";
const LOCAL_BETTER_AUTH_URL = "http://localhost:3000";
const MINIMUM_SECRET_LENGTH = 32;

export type AuthEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "NODE_ENV">
>;

type TendnoteAuthOverrides = Omit<
  BetterAuthOptions,
  "advanced" | "appName" | "baseURL" | "rateLimit" | "secret" | "trustedOrigins"
> & {
  advanced?: BetterAuthOptions["advanced"];
  rateLimit?: BetterAuthOptions["rateLimit"];
};

export function resolveBetterAuthSecret(env: AuthEnvironment = process.env): string {
  const secret = env.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    if (env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_SECRET is required in production.");
    }

    return LOCAL_BETTER_AUTH_SECRET;
  }

  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`BETTER_AUTH_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters.`);
  }

  return secret;
}

export function resolveBetterAuthBaseUrl(env: AuthEnvironment = process.env): string {
  const configured = env.BETTER_AUTH_URL?.trim();

  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_URL is required in production.");
    }

    return LOCAL_BETTER_AUTH_URL;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid absolute URL.");
  }

  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
  }

  return url.origin;
}

/**
 * The shared security-sensitive Better Auth baseline used by every Tendnote
 * server process that reads sessions. Feature-specific providers and hooks stay
 * with their owning app, while cookie, origin, secret, and storage policy cannot
 * drift between the web and Eve services.
 */
export function createTendnoteAuthOptions(
  overrides: TendnoteAuthOverrides,
  env: AuthEnvironment = process.env,
): BetterAuthOptions {
  const baseURL = resolveBetterAuthBaseUrl(env);
  const production = env.NODE_ENV === "production";

  return {
    ...overrides,
    appName: "Tendnote",
    baseURL,
    secret: resolveBetterAuthSecret(env),
    trustedOrigins: [baseURL],
    advanced: {
      ...overrides.advanced,
      useSecureCookies: production,
    },
    rateLimit: {
      ...(overrides.secondaryStorage ? { storage: "secondary-storage" as const } : {}),
      ...overrides.rateLimit,
    },
  };
}

export function createTendnoteAuth(
  overrides: TendnoteAuthOverrides,
  env: AuthEnvironment = process.env,
) {
  return betterAuth(createTendnoteAuthOptions(overrides, env));
}
