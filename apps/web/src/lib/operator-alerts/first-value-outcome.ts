import type { FirstValueOutcome } from "@tendnote/domain/operator-alerts";
import type { FirstValueCheck, ModelStepResult } from "../first-value-check";

/** Debounce only recognized transient generation failures, never bookkeeping. */
function transient(attempt: ModelStepResult["attempts"][number]): boolean {
  if (attempt.phase !== "gateway") return false;
  if (attempt.outcome === "deadline") return true;
  if (
    attempt.outcome === "failed" &&
    (["authentication_error", "invalid_request_error", "configuration_error"].includes(
      attempt.type ?? "",
    ) ||
      ["GatewayAuthenticationError", "GatewayInvalidRequestError"].includes(attempt.error ?? ""))
  )
    return false;
  return (
    attempt.outcome === "failed" &&
    attempt.retryable &&
    [408, 429, 500, 502, 503, 504].includes(attempt.status ?? 0)
  );
}

export function firstValueOutcome(check: FirstValueCheck | null): FirstValueOutcome {
  if (check?.status !== "ran") return "unknown";
  if (check.failed.some((step) => step !== "model")) return "serious";
  const model = check.model;
  if (check.failed.includes("model")) {
    return model && model.attempts.length > 0 && model.attempts.every(transient)
      ? "failed"
      : "serious";
  }
  if (!model?.passed || model.attempts.length === 0) return "unknown";
  const failures = model.attempts.filter((attempt) => attempt.outcome !== "passed");
  if (failures.some((attempt) => !transient(attempt))) return "serious";
  return failures.length ? "retried" : model.attempts.length === 1 ? "clean" : "unknown";
}
