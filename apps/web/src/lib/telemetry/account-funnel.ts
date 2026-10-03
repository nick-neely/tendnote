import {
  recordRequestFunnelStage,
  suppressRequestFunnelStage,
} from "@tendnote/db/queries/account-telemetry";
import {
  isTelemetryEligibleCountry,
  type RequestFunnelStage,
} from "@tendnote/domain/account-funnel";
import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import { requestCountry } from "@/lib/access/region-block";

export type RequestFunnelCaptureDependencies = {
  env?: AdmissionEnvironment;
  record?: typeof recordRequestFunnelStage;
  suppress?: typeof suppressRequestFunnelStage;
};

/**
 * Capture a funnel stage the account's own request started: signup completed
 * or checkout started. Collection is optional telemetry, so it happens only in
 * hosted mode and only when Vercel's edge says the request came from the US;
 * an unknown or any other country is suppressed before anything is written,
 * and suspends the account's enrolment so the payment, admission, and
 * milestone stages that follow this action are suppressed with it. The write
 * itself re-checks the opt-out and any pending deletion.
 *
 * Never throws: telemetry must not fail a signup or a checkout.
 */
export async function captureRequestFunnelStage(
  input: { userId: string; stage: RequestFunnelStage; headers: Pick<Headers, "get"> | undefined },
  dependencies: RequestFunnelCaptureDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const record = dependencies.record ?? recordRequestFunnelStage;

  const suppress = dependencies.suppress ?? suppressRequestFunnelStage;

  if (parseAdmissionPolicy(env).mode !== "hosted") return;
  const stage = { userId: input.userId, stage: input.stage };
  if (input.headers && isTelemetryEligibleCountry(requestCountry(input.headers))) {
    await record(stage);
  } else {
    await suppress(stage);
  }
}
