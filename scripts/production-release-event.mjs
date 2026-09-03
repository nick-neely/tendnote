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
  return (
    classifyEnvironment(input.environment) ??
    classifyRef(input.ref) ??
    classifyState(input.state) ??
    classifyProject(input.projectId, input.expectedProjectId)
  );
}

function invalidEvent(message) {
  return { kind: "invalid", message };
}

function ignoredEvent(message) {
  return { kind: "ignore", message };
}

function classifyEnvironment(environment) {
  if (!environment) {
    return invalidEvent("Malformed Vercel deployment event: missing client_payload.environment.");
  }

  if (environment !== "production") {
    return ignoredEvent(
      `Ignoring ${environment} deployment; production migrations only run for production.`,
    );
  }

  return null;
}

function classifyRef(ref) {
  if (!ref) {
    return invalidEvent("Malformed Vercel deployment event: missing client_payload.git.ref.");
  }

  if (ref !== "main") {
    return ignoredEvent(
      `Ignoring deployment from ${ref}; production migrations only run for main.`,
    );
  }

  return null;
}

function classifyState(state) {
  if (!state) {
    return invalidEvent("Malformed Vercel deployment event: missing client_payload.state.type.");
  }

  if (state !== "ready") {
    return ignoredEvent(`Ignoring deployment in ${state} state; migrations wait for ready.`);
  }

  return null;
}

function classifyProject(projectId, expectedProjectId) {
  if (!projectId) {
    return invalidEvent("Malformed Vercel deployment event: missing client_payload.project.id.");
  }

  if (!expectedProjectId) {
    return invalidEvent(
      "Production migration gate is not configured: set the repository variable VERCEL_PROJECT_ID to this Vercel project's project id.",
    );
  }

  if (!VERCEL_PROJECT_ID_PATTERN.test(expectedProjectId)) {
    return invalidEvent(
      "Production migration gate is misconfigured: VERCEL_PROJECT_ID must start with prj_.",
    );
  }

  if (projectId !== expectedProjectId) {
    return invalidEvent(
      `Production migration gate project mismatch: event project ${projectId} does not match configured project ${expectedProjectId}.`,
    );
  }

  return {
    kind: "release",
    message: `Running production migrations for Vercel project ${projectId}.`,
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
