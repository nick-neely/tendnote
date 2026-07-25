/**
 * The environment variable a measured build sets to expose Next's
 * instant-navigation testing API in a production build.
 *
 * `@next/playwright`'s `instant()` is a no-op unless the build opted in, and a
 * no-op `instant()` makes every assertion inside it pass against fully streamed
 * content. The flag therefore has to be deliberate on both sides: the harness
 * only trusts a build that set it, and the build only sets it away from the real
 * production deployment.
 */
export const INSTANT_MATRIX_ENV_FLAG = "TENDNOTE_INSTANT_MATRIX";

/** The subset of the build environment the gate reads. */
export type InstantTestingApiEnvironment = {
  vercelEnv?: string;
  [INSTANT_MATRIX_ENV_FLAG]?: string;
};

/**
 * Whether `experimental.exposeTestingApiInProductionBuild` should be enabled for
 * this build.
 *
 * Enabled for the two environments that are measured: an explicitly opted-in
 * build (local rig and CI, which set {@link INSTANT_MATRIX_ENV_FLAG}) and Vercel
 * Preview, where ADR 0211 runs the full upgrade-and-promotion matrix before
 * promotion. Never enabled for `VERCEL_ENV=production`, which is the deployment
 * real owners use — a cookie that suppresses dynamic data must not be reachable
 * there, whatever the rest of the environment says.
 */
export function exposesInstantTestingApi(env: InstantTestingApiEnvironment): boolean {
  if (env.vercelEnv === "production") return false;

  return env[INSTANT_MATRIX_ENV_FLAG] === "1" || env.vercelEnv === "preview";
}

/** Read the gate from the live build environment. */
export function exposesInstantTestingApiFromProcess(
  processEnv: NodeJS.ProcessEnv = process.env,
): boolean {
  return exposesInstantTestingApi({
    vercelEnv: processEnv.VERCEL_ENV,
    [INSTANT_MATRIX_ENV_FLAG]: processEnv[INSTANT_MATRIX_ENV_FLAG],
  });
}
