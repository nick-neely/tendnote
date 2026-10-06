import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { hostedModel } from "@tendnote/db/queries/model-calls";
import { parseAdmissionPolicy } from "@tendnote/domain";
import { generateText } from "ai";
import { Client } from "eve/client";
import Stripe from "stripe";
import { readHostedStripeBillingConfig } from "@/lib/billing/checkout";
import { getRedis } from "@/lib/cache/redis";
import { MARKETING_URL } from "@/lib/public-links";

/**
 * The synthetic First Value check (#649), one of the three Reliability
 * Indicators. Every alert pass it walks the path a newcomer takes, as far as
 * it can without a customer account: the landing page loads, Checkout's prices
 * are live in Stripe, and a dedicated operator-owned account signs in through
 * the deployment and is admitted by Eve, whose model answers. Once a day it
 * also asks Eve a question only that account's fixture Memory answers, which
 * costs one real turn; the cheap steps cost a few tokens a pass (ADR 0263).
 */

/** The fixture the synthetic account holds, created through the product when it is provisioned. */
export const FIRST_VALUE_FIXTURE = {
  person: "Marlow Finch",
  memory: "Marlow's favourite tea is lapsang souchong.",
  question: "What is Marlow Finch's favourite tea? Answer in five words or fewer.",
  answer: /lapsang/i,
} as const;

/**
 * From this UTC hour each day, the first pass that reaches Eve asks it the
 * fixture question: 9:00 or 10:00 Central, inside the operator's waking hours.
 */
const GROUNDED_ANSWER_HOUR_UTC = 15;
const GROUNDED_ANSWER_CLAIM_TTL_SECONDS = 2 * 24 * 60 * 60;

/** Sets `key` only if it is unset, reporting whether this caller set it. */
type SetOnce = (key: string, ttlSeconds: number) => Promise<boolean>;

const redisSetOnce: SetOnce = async (key, ttlSeconds) =>
  (await getRedis().set(key, "1", "EX", ttlSeconds, "NX")) === "OK";

/**
 * Whether this pass asks Eve today's grounded question. Only the first pass at
 * or after the grounded hour claims the UTC day, so a late or failed pass is
 * made up by the next one and two passes never both pay for a turn.
 */
export async function claimDailyGroundedAnswer(
  now: Date,
  setOnce: SetOnce = redisSetOnce,
): Promise<boolean> {
  if (now.getUTCHours() < GROUNDED_ANSWER_HOUR_UTC) return false;
  const day = now.toISOString().slice(0, 10);
  return setOnce(`tendnote:first-value-check:grounded:${day}`, GROUNDED_ANSWER_CLAIM_TTL_SECONDS);
}

type FirstValueCheckStep =
  | "landing"
  | "checkout"
  | "sign_in"
  | "admission"
  | "model"
  | "grounded_answer";

/** The steps every pass walks. */
type FirstValuePathStep = Exclude<FirstValueCheckStep, "grounded_answer">;

export type FirstValueCheck =
  | { status: "off" }
  | {
      status: "ran";
      /** Every cheap step that failed; empty when the path is up. */
      failed: FirstValuePathStep[];
      /** `null` when the grounded answer was not asked this pass, or could not be. */
      groundedAnswer: boolean | null;
    };

type FirstValueCheckEnvironment = Record<string, string | undefined>;

type FirstValueCheckDependencies = {
  env?: FirstValueCheckEnvironment;
  fetch?: typeof fetch;
  /** Whether a Stripe price is active, keyed by its id. */
  priceIsActive?: (input: { secretKey: string; priceId: string }) => Promise<boolean>;
  /** One tiny metered call on the model Eve runs, as the synthetic account. */
  pingModel?: (input: { accountId: string; modelId: string }) => Promise<void>;
  /** Eve's whole reply to one question in a fresh session, as the signed-in account. */
  askEve?: (input: { appUrl: string; cookie: string; question: string }) => Promise<string>;
};

const STEP_TIMEOUT_MS = 15_000;
const EVE_TURN_TIMEOUT_MS = 120_000;

function readConfig(env: FirstValueCheckEnvironment) {
  const email = env.TENDNOTE_SYNTHETIC_CHECK_EMAIL?.trim();
  const password = env.TENDNOTE_SYNTHETIC_CHECK_PASSWORD;
  if (!email || !password || parseAdmissionPolicy(env).mode !== "hosted") return null;
  return { email, password, appUrl: resolveBetterAuthBaseUrl(env) };
}

const defaultPriceIsActive: NonNullable<FirstValueCheckDependencies["priceIsActive"]> = async ({
  secretKey,
  priceId,
}) => (await new Stripe(secretKey).prices.retrieve(priceId)).active;

const defaultPingModel: NonNullable<FirstValueCheckDependencies["pingModel"]> = async ({
  accountId,
  modelId,
}) => {
  await generateText({
    model: hostedModel({ modelId, costCategory: "interactive", account: accountId }),
    prompt: "Reply with the single word OK.",
    maxOutputTokens: 16,
    abortSignal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
};

const defaultAskEve: NonNullable<FirstValueCheckDependencies["askEve"]> = async ({
  appUrl,
  cookie,
  question,
}) => {
  const client = new Client({ host: appUrl, headers: { cookie }, redirect: "error" });
  const { session, response } = await client.sessions.create({ message: question });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      response.result(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Eve turn timed out")), EVE_TURN_TIMEOUT_MS);
      }),
    ]);
    return result.status === "failed" ? "" : (result.message ?? "");
  } finally {
    clearTimeout(timer);
    // One retired session a day; nothing else reads the synthetic account's threads.
    await session.reset({ reason: "Synthetic First Value check" }).catch(() => undefined);
  }
};

/** The `name=value` pairs of a response's cookies, as one request `Cookie` header. */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

type FirstValueCheckConfig = NonNullable<ReturnType<typeof readConfig>>;

async function signIn(
  doFetch: typeof fetch,
  config: FirstValueCheckConfig,
): Promise<{ cookie: string; accountId: string } | null> {
  const response = await doFetch(`${config.appUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.appUrl },
    body: JSON.stringify({ email: config.email, password: config.password }),
    redirect: "manual",
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: { id?: unknown } };
  const cookie = cookieHeader(response);
  return typeof body.user?.id === "string" && cookie ? { cookie, accountId: body.user.id } : null;
}

/**
 * Ends the pass's session. A failure is logged as
 * `first_value_check.cleanup_failed` with only an HTTP status or error class,
 * and never changes the pass's result or alerts.
 */
async function signOut(doFetch: typeof fetch, appUrl: string, cookie: string) {
  let reason: string;
  try {
    const response = await doFetch(`${appUrl}/api/auth/sign-out`, {
      method: "POST",
      // Better Auth accepts only JSON request bodies (#746).
      headers: { "content-type": "application/json", cookie, origin: appUrl },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    if (response.ok) return;
    reason = `http_${response.status}`;
  } catch (error) {
    reason = error instanceof Error ? error.name : "unknown";
  }
  console.error("first_value_check.cleanup_failed", { reason });
}

/**
 * Runs one step, logging any failure as `first_value_check.failed` and giving
 * `null` for it. The log names the step and an error class, never a value.
 */
async function attempt<T>(
  step: FirstValueCheckStep,
  run: () => Promise<T | null | false>,
): Promise<T | null> {
  try {
    const result = await run();
    if (result) return result;
    console.error("first_value_check.failed", { step, reason: "unexpected_result" });
  } catch (error) {
    console.error("first_value_check.failed", {
      step,
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
  return null;
}

async function passes(step: FirstValueCheckStep, run: () => Promise<boolean>): Promise<boolean> {
  return (await attempt(step, run)) !== null;
}

/**
 * Walks the First Value path once. Off unless this is a hosted deployment with
 * the synthetic account's credentials set. Each step that fails is logged as
 * `first_value_check.failed` and reported; only an invalid app URL throws.
 * Once Eve has admitted the account, `claimGroundedAnswer` decides whether this
 * pass also asks the fixture question.
 */
export async function checkFirstValuePath(
  input: { claimGroundedAnswer?: () => Promise<boolean> } & FirstValueCheckDependencies = {},
): Promise<FirstValueCheck> {
  const env = input.env ?? process.env;
  const config = readConfig(env);
  if (!config) return { status: "off" };
  const doFetch = input.fetch ?? fetch;
  const priceIsActive = input.priceIsActive ?? defaultPriceIsActive;
  const failed: FirstValuePathStep[] = [];

  const [landing, checkout] = await Promise.all([
    passes("landing", async () => {
      const response = await doFetch(MARKETING_URL, {
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      return response.ok;
    }),
    passes("checkout", async () => {
      const stripe = readHostedStripeBillingConfig(env);
      if (!stripe) return false;
      const active = await Promise.all(
        Object.values(stripe.prices).map((priceId) =>
          priceIsActive({ secretKey: stripe.secretKey, priceId }),
        ),
      );
      return active.every(Boolean);
    }),
  ]);
  if (!landing) failed.push("landing");
  if (!checkout) failed.push("checkout");

  const account = await attempt("sign_in", () => signIn(doFetch, config));
  if (!account) {
    failed.push("sign_in");
    return { status: "ran", failed, groundedAnswer: null };
  }
  const { cookie, accountId } = account;

  try {
    // Eve's inspection route runs the channel's whole auth policy, admission
    // included, without starting a turn, and names the model Eve runs.
    const info = await attempt("admission", async () => {
      const response = await doFetch(`${config.appUrl}/eve/v1/info`, {
        headers: { cookie },
        redirect: "manual",
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { agent?: { model?: { id?: unknown } } };
      return { modelId: typeof body.agent?.model?.id === "string" ? body.agent.model.id : null };
    });
    if (!info) failed.push("admission");
    const model = await passes("model", async () => {
      if (!info?.modelId) return false;
      await (input.pingModel ?? defaultPingModel)({ accountId, modelId: info.modelId });
      return true;
    });
    if (!model) failed.push("model");

    if (!info || !(await input.claimGroundedAnswer?.())) {
      return { status: "ran", failed, groundedAnswer: null };
    }
    const groundedAnswer = await passes("grounded_answer", async () => {
      const reply = await (input.askEve ?? defaultAskEve)({
        appUrl: config.appUrl,
        cookie,
        question: FIRST_VALUE_FIXTURE.question,
      });
      return FIRST_VALUE_FIXTURE.answer.test(reply);
    });
    return { status: "ran", failed, groundedAnswer };
  } finally {
    await signOut(doFetch, config.appUrl, cookie);
  }
}
