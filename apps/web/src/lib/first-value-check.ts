import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { hostedModel, type ModelGenerationPhase } from "@tendnote/db/queries/model-calls";
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
      /** Content-free evidence from this pass's model step, when it ran. */
      model?: ModelStepResult;
    };

type FirstValueCheckEnvironment = Record<string, string | undefined>;

type FirstValueCheckDependencies = {
  env?: FirstValueCheckEnvironment;
  fetch?: typeof fetch;
  /** Whether a Stripe price is active, keyed by its id. */
  priceIsActive?: (input: { secretKey: string; priceId: string }) => Promise<boolean>;
  /**
   * One attempt at a tiny metered call on the model Eve runs, as the synthetic
   * account, abandoned when `abortSignal` fires. It must not retry itself.
   */
  callModel?: (input: {
    accountId: string;
    modelId: string;
    abortSignal: AbortSignal;
    onGeneratePhase: (phase: ModelGenerationPhase) => void;
  }) => Promise<void>;
  /** Eve's whole reply to one question in a fresh session, as the signed-in account. */
  askEve?: (input: { appUrl: string; cookie: string; question: string }) => Promise<string>;
};

const STEP_TIMEOUT_MS = 15_000;
const EVE_TURN_TIMEOUT_MS = 120_000;
/**
 * Retain the full 15-second allowance per attempt. A timed-out call gets one
 * same-pass confirmation within 32 seconds total (15 + 2 + 15), rather than
 * waiting for the next ten-minute sample. Fast retryable failures retain the
 * existing three-call cap and 2s/4s backoff. SDK retries remain disabled.
 */
const MODEL_STEP_TIMEOUT_MS = 32_000;
const MODEL_RETRY_DELAYS_MS = [2_000, 4_000];

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

const defaultCallModel: NonNullable<FirstValueCheckDependencies["callModel"]> = async ({
  accountId,
  modelId,
  abortSignal,
  onGeneratePhase,
}) => {
  await generateText({
    model: hostedModel({
      modelId,
      costCategory: "interactive",
      account: accountId,
      onGeneratePhase,
    }),
    prompt: "Reply with the single word OK.",
    maxOutputTokens: 16,
    // The model step retries, so each failed call reaches it and is recorded.
    maxRetries: 0,
    abortSignal,
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
 * One model call's outcome, in allowlisted fields only. `deadline` means the
 * step's deadline cut the call short; `failed` keeps what the gateway said.
 */
type FailedModelAttempt = {
  outcome: "failed";
  elapsedMs: number;
  error?: string;
  status?: number;
  type?: string;
  retryable: boolean;
  generationId?: string;
};
type ModelAttempt = ({ outcome: "passed" | "deadline"; elapsedMs: number } | FailedModelAttempt) & {
  phase: ModelGenerationPhase | "model_call";
};

export type ModelStepResult = {
  passed: boolean;
  reason?: string;
  elapsedMs: number;
  attempts: ModelAttempt[];
};

/** A short identifier-like string, or nothing: free text never reaches the log. */
function token(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/**
 * What a failed call says, from the fields the AI SDK's gateway and API errors
 * carry. The message and response body are never read.
 */
function failedAttempt(error: unknown, elapsedMs: number): FailedModelAttempt {
  const fields = (typeof error === "object" && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const status = fields.statusCode;
  const attempt: FailedModelAttempt = {
    outcome: "failed",
    elapsedMs,
    error: token(fields.name),
    status: Number.isInteger(status) ? (status as number) : undefined,
    type: token(fields.type),
    retryable: fields.isRetryable === true,
    generationId: token(fields.generationId),
  };
  return Object.fromEntries(
    Object.entries(attempt).filter(([, value]) => value !== undefined),
  ) as FailedModelAttempt;
}

/** Settles with `work`, or rejects once `signal` fires, whichever comes first. */
function untilAborted(work: Promise<void>, signal: AbortSignal): Promise<void> {
  // A call that ignores its signal settles later, unobserved.
  work.catch(() => undefined);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Waits `ms`, or less when `signal` fires first; whether the wait ran its course. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type ModelCall = (
  abortSignal: AbortSignal,
  onPhase: (phase: ModelGenerationPhase) => void,
) => Promise<void>;

/** One attempt owns its abort signal, and also stops at the total deadline. */
async function modelAttempt(
  call: ModelCall,
  deadline: AbortSignal,
  progress: { phase: ModelAttempt["phase"] },
): Promise<ModelAttempt> {
  const started = Date.now();
  const attempt = new AbortController();
  const abort = () => attempt.abort();
  deadline.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, STEP_TIMEOUT_MS);
  try {
    await untilAborted(
      call(attempt.signal, (phase) => {
        progress.phase = phase;
      }),
      attempt.signal,
    );
    return { outcome: "passed", elapsedMs: Date.now() - started, phase: progress.phase };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const result = attempt.signal.aborted
      ? { outcome: "deadline" as const, elapsedMs }
      : failedAttempt(error, elapsedMs);
    return { ...result, phase: progress.phase };
  } finally {
    clearTimeout(timer);
    deadline.removeEventListener("abort", abort);
  }
}

/** Never buy another generation to hide a usage-persistence failure. */
function canRetryModelAttempt(attempt: ModelAttempt): boolean {
  if (attempt.phase === "usage_ledger" || attempt.phase === "complete") return false;
  return attempt.outcome === "deadline" || (attempt.outcome === "failed" && attempt.retryable);
}

/** Confirm a transient failure in this pass, retaining all attempts under one budget. */
async function modelStep(call: ModelCall): Promise<ModelStepResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), MODEL_STEP_TIMEOUT_MS);
  const started = Date.now();
  const attempts: ModelAttempt[] = [];
  let reason = "unknown";
  let mayRetry = () => true;
  try {
    for (const [index, delayMs] of [0, ...MODEL_RETRY_DELAYS_MS].entries()) {
      if (index > 0 && !(await wait(delayMs, deadline.signal))) {
        reason = "deadline";
        break;
      }
      // A canceled generation may reach metering while backoff is running.
      if (!mayRetry()) break;
      // Injected calls may not expose phases; never guess that it is the gateway.
      const progress: { phase: ModelAttempt["phase"] } = { phase: "model_call" };
      const attempt = await modelAttempt(call, deadline.signal, progress);
      mayRetry = () => canRetryModelAttempt({ ...attempt, phase: progress.phase });
      attempts.push(attempt);
      if (attempt.outcome === "passed") {
        const result: ModelStepResult = { passed: true, elapsedMs: Date.now() - started, attempts };
        console.info("first_value_check.passed", {
          step: "model",
          elapsedMs: result.elapsedMs,
          attempts,
        });
        return result;
      }
      reason = attempt.outcome === "failed" ? (attempt.error ?? "unknown") : "deadline";
      if (deadline.signal.aborted || !mayRetry()) break;
    }
  } finally {
    clearTimeout(timer);
  }
  const result: ModelStepResult = {
    passed: false,
    reason,
    elapsedMs: Date.now() - started,
    attempts,
  };
  console.error("first_value_check.failed", {
    step: "model",
    reason,
    elapsedMs: result.elapsedMs,
    attempts,
  });
  return result;
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
    const modelId = info?.modelId;
    const callModel = input.callModel ?? defaultCallModel;
    if (!modelId) {
      console.error("first_value_check.failed", {
        step: "model",
        reason: "unexpected_result",
        elapsedMs: 0,
        attempts: [],
      });
    }
    const model = modelId
      ? await modelStep((abortSignal, onGeneratePhase) =>
          callModel({ accountId, modelId, abortSignal, onGeneratePhase }),
        )
      : undefined;
    if (!model?.passed) failed.push("model");

    if (!info || !(await input.claimGroundedAnswer?.())) {
      return { status: "ran", failed, groundedAnswer: null, model };
    }
    const groundedAnswer = await passes("grounded_answer", async () => {
      const reply = await (input.askEve ?? defaultAskEve)({
        appUrl: config.appUrl,
        cookie,
        question: FIRST_VALUE_FIXTURE.question,
      });
      return FIRST_VALUE_FIXTURE.answer.test(reply);
    });
    return { status: "ran", failed, groundedAnswer, model };
  } finally {
    await signOut(doFetch, config.appUrl, cookie);
  }
}
