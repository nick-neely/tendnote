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
