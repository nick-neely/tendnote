import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const VERCEL_PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9]+$/;

/**
 * Decide whether a Vercel repository-dispatch event owns the production
 * migration gate. The event is untrusted input: only an exact production,
 * main, ready event for the configured project may run migrations.
 *
 * @param {{
 *   environment?: string;
 *   projectId?: string;
 *   ref?: string;
 *   state?: string;
 *   expectedProjectId?: string;
 * }} input
 * @returns {{ kind: "release" | "ignore" | "invalid"; message: string }}
 */
export function classifyProductionReleaseEvent(input) {
  const missing = Object.entries({
    "client_payload.environment": input.environment,
    "client_payload.project.id": input.projectId,
    "client_payload.git.ref": input.ref,
    "client_payload.state.type": input.state,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    return {
      kind: "invalid",
      message: `Malformed Vercel deployment event: missing ${missing.join(", ")}.`,
    };
  }

  if (input.environment !== "production") {
    return {
      kind: "ignore",
      message: `Ignoring ${input.environment} deployment; production migrations only run for production.`,
    };
  }

  if (input.ref !== "main") {
    return {
      kind: "ignore",
      message: `Ignoring deployment from ${input.ref}; production migrations only run for main.`,
    };
  }

  if (input.state !== "ready") {
    return {
      kind: "ignore",
      message: `Ignoring deployment in ${input.state} state; migrations wait for ready.`,
    };
  }

  if (!input.expectedProjectId) {
    return {
      kind: "invalid",
      message:
        "Production migration gate is not configured: set the repository variable VERCEL_PROJECT_ID to this Vercel project's project id.",
    };
  }

  if (!VERCEL_PROJECT_ID_PATTERN.test(input.expectedProjectId)) {
    return {
      kind: "invalid",
      message:
        "Production migration gate is misconfigured: VERCEL_PROJECT_ID must start with prj_.",
    };
  }

  if (input.projectId !== input.expectedProjectId) {
    return {
      kind: "invalid",
      message: `Production migration gate project mismatch: event project ${input.projectId} does not match configured project ${input.expectedProjectId}.`,
    };
  }

  return {
    kind: "release",
    message: `Running production migrations for Vercel project ${input.projectId}.`,
  };
}

function runFromEnvironment(outputPath) {
  const result = classifyProductionReleaseEvent({
    environment: process.env.VERCEL_EVENT_ENVIRONMENT,
    expectedProjectId: process.env.VERCEL_EXPECTED_PROJECT_ID,
    projectId: process.env.VERCEL_EVENT_PROJECT_ID,
    ref: process.env.VERCEL_EVENT_REF,
    state: process.env.VERCEL_EVENT_STATE,
  });

  const annotation = result.kind === "invalid" ? "error" : "notice";
  console.log(`::${annotation} title=Production migration gate::${result.message}`);

  if (outputPath) {
    appendFileSync(outputPath, `should_release=${result.kind === "release"}\n`);
  }

  if (result.kind === "invalid") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromEnvironment(process.argv[2]);
}
