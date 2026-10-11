import type { ClaimedOperatorAlertNotice } from "@tendnote/db/queries/operator-alerts";
import { operatorAlertMessage } from "@tendnote/domain/operator-alerts";
import type { FirstValueCheck, ModelStepResult } from "../first-value-check";
import type { OperatorAlertMessage } from "./channel";

/** Only fixed step/phase labels and bounded numeric diagnostics leave the app. */
const STEP_LABELS = {
  landing: "landing page",
  checkout: "Checkout prices",
  sign_in: "sign-in",
  admission: "Eve admission",
  model: "model",
} as const;
const PHASE_LABELS = {
  model_call: "model call (phase unavailable)",
  gateway: "gateway generation",
  usage_ledger: "usage-ledger persistence",
  complete: "generation and metering completed",
} as const;

function milliseconds(value: number): string {
  return Number.isFinite(value) && value >= 0 && value <= 300_000
    ? `${Math.round(value)} ms`
    : "unavailable";
}

type Sample = { firstValue: FirstValueCheck | null; observedInThisPass: boolean };

function attemptLine(attempt: ModelStepResult["attempts"][number], index: number): string {
  const outcome =
    attempt.outcome === "deadline"
      ? "deadline"
      : attempt.outcome === "passed"
        ? "passed"
        : "failed";
  const phase = PHASE_LABELS[attempt.phase] ?? "phase unavailable";
  const code = "status" in attempt ? attempt.status : undefined;
  const status =
    typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599
      ? `; HTTP ${code}`
      : "";
  return `Attempt ${index + 1}: ${outcome}; ${milliseconds(attempt.elapsedMs)}; ${phase}${status}.`;
}

function currentEvidence(sample: Sample): string[] {
  const check = sample.firstValue;
  // A delayed/retried notice must not borrow evidence from a different pass.
  if (!sample.observedInThisPass || check?.status !== "ran" || check.failed.length === 0) {
    return [
      "Original step details are unavailable in this delivery; inspect first_value_check.failed near the first failing sample.",
    ];
  }
  const steps = Object.entries(STEP_LABELS)
    .filter(([step]) => check.failed.includes(step as keyof typeof STEP_LABELS))
    .map(([, label]) => label);
  const lines = [`Failed steps: ${steps.join(", ")}.`];
  if (!check.failed.includes("model")) return lines;
  if (!check.model) return [...lines, "Model step did not run: admission did not provide a model."];
  lines.push(
    `Model step: ${milliseconds(check.model.elapsedMs)}; ${Math.min(check.model.attempts.length, 3)} attempt(s).`,
  );
  return [...lines, ...check.model.attempts.slice(0, 3).map(attemptLine)];
}

function firstValueBody(notice: ClaimedOperatorAlertNotice, sample: Sample): string {
  const lines = [`First failing sample: ${notice.openedAt.toISOString()}.`];
  if (notice.kind === "recovery") {
    lines.push(`Passing sample: ${notice.clearedAt?.toISOString() ?? "unavailable"}.`);
    lines.push(
      "A later synthetic sample passed. These samples do not measure continuous outage duration or establish customer impact.",
    );
  } else {
    lines.push(...currentEvidence(sample));
    lines.push(
      "Customer impact is unverified. The check samples a synthetic account, not customer traffic. Inspect first_value_check.failed and first_value_check.passed in the logs.",
    );
  }
  return lines.join("\n");
}

export function noticeMessage(
  notice: ClaimedOperatorAlertNotice,
  sample: Sample,
): OperatorAlertMessage {
  const message = operatorAlertMessage(notice);
  if (notice.condition === "first_value_path") message.body = firstValueBody(notice, sample);
  return {
    ...message,
    urgent: notice.kind === "alert",
    key: `operator-alert:${notice.episodeId}:${notice.kind}`,
  };
}
