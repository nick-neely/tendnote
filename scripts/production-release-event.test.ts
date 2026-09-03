import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyProductionReleaseEvent } from "./production-release-event.mjs";

const testProjectId = ["prj", "test"].join("_");
const otherProjectId = ["prj", "other"].join("_");
const scriptPath = fileURLToPath(new URL("./production-release-event.mjs", import.meta.url));

const baseEvent = {
  environment: "production",
  expectedProjectId: testProjectId,
  projectId: testProjectId,
  ref: "main",
  state: "ready",
};

function runCli(overrides: Record<string, string> = {}) {
  const outputDirectory = mkdtempSync(join(tmpdir(), "tendnote-production-release-event-"));
  const outputPath = join(outputDirectory, "github-output");

  try {
    const result = spawnSync(process.execPath, [scriptPath, outputPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_EVENT_ENVIRONMENT: baseEvent.environment,
        VERCEL_EVENT_PROJECT_ID: baseEvent.projectId,
        VERCEL_EVENT_REF: baseEvent.ref,
        VERCEL_EVENT_STATE: baseEvent.state,
        VERCEL_EXPECTED_PROJECT_ID: baseEvent.expectedProjectId,
        ...overrides,
      },
    });

    return {
      output: readFileSync(outputPath, "utf8"),
      result,
    };
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
}

describe("production release event classifier", () => {
  it("releases an exact production ready event for the configured project", () => {
    expect(classifyProductionReleaseEvent(baseEvent)).toMatchObject({ kind: "release" });
  });

  it.each([
    ["preview deployment", { environment: "preview" }],
    ["non-main deployment", { ref: "feature/assistant" }],
    ["non-ready deployment", { state: "building" }],
  ])("ignores a %s", (_name, change) => {
    expect(classifyProductionReleaseEvent({ ...baseEvent, ...change })).toMatchObject({
      kind: "ignore",
    });
  });

  it("fails a target-like event for a different Vercel project", () => {
    // Keep the deployment revision identical: project scoping must reject the
    // event before any commit-status path can treat it as this deployment.
    expect(
      classifyProductionReleaseEvent({ ...baseEvent, projectId: otherProjectId }),
    ).toMatchObject({
      kind: "invalid",
    });
  });

  it("fails when the dispatch payload is incomplete", () => {
    expect(classifyProductionReleaseEvent({ ...baseEvent, projectId: undefined })).toMatchObject({
      kind: "invalid",
    });
  });

  it("fails a target-like event when the repository variable is absent", () => {
    expect(
      classifyProductionReleaseEvent({ ...baseEvent, expectedProjectId: undefined }),
    ).toMatchObject({ kind: "invalid" });
  });

  it("fails a target-like event when the repository variable is malformed", () => {
    expect(
      classifyProductionReleaseEvent({ ...baseEvent, expectedProjectId: "tendnote-web" }),
    ).toMatchObject({ kind: "invalid" });
  });

  it("writes a successful decision to GITHUB_OUTPUT", () => {
    const { output, result } = runCli();

    expect(result.status).toBe(0);
    expect(output).toBe("should_release=true\n");
    expect(result.stdout).toContain("::notice title=Production migration gate::");
  });

  it("writes a false decision and exits nonzero for invalid configuration", () => {
    const { output, result } = runCli({ VERCEL_EXPECTED_PROJECT_ID: "" });

    expect(result.status).toBe(1);
    expect(output).toBe("should_release=false\n");
    expect(result.stdout).toContain("::error title=Production migration gate::");
  });
});
