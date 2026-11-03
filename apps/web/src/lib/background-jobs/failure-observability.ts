export type BackgroundJobFailureCode =
  | "configuration_missing"
  | "database_driver_incompatible"
  | "persistence_failure"
  | "provider_failure"
  | "processing_failure";

/**
 * Classifies a processor failure without copying its potentially source-derived text
 * into hosted logs. The detailed message remains in the owner-scoped durable job row.
 */
export function classifyBackgroundJobFailure(error: unknown): BackgroundJobFailureCode {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes("missing ") || message.includes("not configured")) {
    return "configuration_missing";
  }
  if (message.includes("no transactions support") || message.includes("neon-http")) {
    return "database_driver_incompatible";
  }
  if (
    message.includes("failed query") ||
    message.includes("foreign key") ||
    message.includes("constraint") ||
    message.includes("database")
  ) {
    return "persistence_failure";
  }
  if (
    message.includes("provider") ||
    message.includes("gateway") ||
    message.includes("model") ||
    message.includes("schema")
  ) {
    return "provider_failure";
  }
  return "processing_failure";
}

/**
 * Runs one stage of a pass, turning a throw into a logged, content-free failure
 * so the stages after it still run. Only the error's class is logged: a stage's
 * message can carry database or provider detail. A logger that throws never
 * replaces the failure being reported.
 */
export async function settleStage<T>(input: {
  event: string;
  stage: string;
  run: () => Promise<T>;
  logger?: { error?: (message: string, fields: Record<string, unknown>) => void };
}): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await input.run() };
  } catch (reason) {
    try {
      input.logger?.error?.(input.event, {
        stage: input.stage,
        errorCode: classifyBackgroundJobFailure(reason),
      });
    } catch {
      // Diagnostics are best effort.
    }
    return { status: "rejected", reason };
  }
}
