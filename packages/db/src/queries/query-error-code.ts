/**
 * What a swallowed query failure may log about itself: the Postgres error code,
 * else the error's name. Never its message, which carries the query's
 * parameters, an account id among them.
 */
export function queryErrorCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === "string") return cause.code;
  return error instanceof Error ? error.name : "unknown";
}
