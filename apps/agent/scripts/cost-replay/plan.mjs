export const variants = {
  light: { turns: 40, captures: 20, people: 15, followups: 10, uploads: 2 },
  typical: { turns: 150, captures: 80, people: 40, followups: 30, uploads: 8 },
  heavy: { turns: 600, captures: 300, people: 150, followups: 100, uploads: 30 },
};
export const models = {
  agent: "google/gemini-3.7-flash",
  extraction: "google/gemini-3.1-flash-lite",
  embedding: "openai/text-embedding-3-small",
};
export const ceilingUsd = 50;
export function assertEvalDatabase(value) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/tendnote_eval" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Cost replay requires a loopback tendnote_eval database without URL options.");
  }
  return value;
}
export function cleanEnvironment(source) {
  // Never inherit .env files, NODE_OPTIONS, cloud credentials, external transports,
  // production DB/Redis URLs, or provider credentials in the child app.
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LANG"].flatMap((key) =>
      source[key] ? [[key, source[key]]] : [],
    ),
  );
  return {
    ...env,
    NODE_ENV: "development",
    CI: "1",
    AI_GATEWAY_API_KEY: "cost-replay-proxy-only",
    TENDNOTE_AGENT_MODEL: models.agent,
    TENDNOTE_SNAPSHOT_MODEL: models.agent,
    TENDNOTE_BRIEF_SUMMARY_MODEL: models.agent,
    TENDNOTE_EXTRACTION_MODEL: models.extraction,
    TENDNOTE_EMBEDDING_MODEL: models.embedding,
    TENDNOTE_EXTRACTION_RUNTIME: "inline",
    TENDNOTE_EMBEDDING_RUNTIME: "inline",
    TENDNOTE_ACTION_EXTRACTION_RUNTIME: "inline",
    TENDNOTE_CONTEXT_FACT_EXTRACTION_RUNTIME: "inline",
    TENDNOTE_DEV_OWNER_USER_ID: "cost-replay-user",
    TENDNOTE_BRIEF_TIMEZONE: "UTC",
  };
}

export function replayScope(mode) {
  if (mode === "--heavy")
    return {
      days: 30,
      ceilingUsd,
      reportQueryAllowanceUsd: 0.005,
      variants: ["heavy"],
      approval: "heavy-month-50-usd",
    };
  if (mode === "--canary")
    return {
      days: 2,
      ceilingUsd: 10,
      reportQueryAllowanceUsd: 0.005,
      variants: ["heavy"],
      approval: "heavy-canary-10-usd",
    };
  return {
    days: 30,
    reportQueryAllowanceUsd: 0,
    ceilingUsd,
    variants: Object.keys(variants),
    approval: `baseline-${ceilingUsd}-usd`,
  };
}
