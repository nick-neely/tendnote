import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `eve dev` compiles the agent by importing every authored module, each as its
 * own content-hashed bundle that inlines the workspace packages it imports.
 * Node never unloads an ES module, so compiling in the long-lived dev host kept
 * every rebuild's copies forever: one shared-file edit retained ~1 GiB (#684).
 * The pinned eve patch compiles development generations in a short-lived child
 * process instead. These tests hold that boundary through eve's real dev entry.
 */

type CompiledManifest = { readonly tools: ReadonlyArray<{ readonly name: string }> };

type PreparedDevelopmentHost = {
  readonly compileResult: { readonly manifest: CompiledManifest };
};

type PrepareDevelopmentApplicationHost = (appRoot: string) => Promise<PreparedDevelopmentHost>;

type CompileAgentFailure = Error & {
  readonly result: { readonly diagnostics: ReadonlyArray<{ readonly severity: string }> };
};

type CompileAgentErrorClass = new (...args: never[]) => CompileAgentFailure;

const PROBE_KEY = "__tendnoteEveCompileProbe";

const eveRoot = dirname(createRequire(import.meta.url).resolve("eve/package.json"));
const scratchRoot = join(import.meta.dirname, "..", ".scratch");

async function loadEveInternal<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(join(eveRoot, relativePath)).href)) as T;
}

const fixtures: string[] = [];

/**
 * A minimal eve app inside the agent package, so `eve` and `zod` resolve as
 * they do for the real agent. A `null` file removes that default file.
 */
function createFixtureApp(files: Record<string, string | null>): string {
  mkdirSync(scratchRoot, { recursive: true });
  const appRoot = mkdtempSync(join(scratchRoot, "eve-compile-isolation-"));
  fixtures.push(appRoot);
  const all: Record<string, string | null> = {
    "package.json": JSON.stringify({ name: "eve-compile-isolation-fixture", type: "module" }),
    "agent/instructions.md": "Answer briefly.",
    "agent/agent.ts": [
      'import { defineAgent } from "eve";',
      'export default defineAgent({ model: "openai/gpt-5.4-mini" });',
    ].join("\n"),
    ...files,
  };
  for (const [path, source] of Object.entries(all)) {
    if (source === null) continue;
    mkdirSync(dirname(join(appRoot, path)), { recursive: true });
    writeFileSync(join(appRoot, path), source);
  }
  return appRoot;
}

const probeTool = [
  'import { defineTool } from "eve/tools";',
  'import { z } from "zod";',
  `const scope = globalThis as { ${PROBE_KEY}?: number };`,
  `scope.${PROBE_KEY} = (scope.${PROBE_KEY} ?? 0) + 1;`,
  "export default defineTool({",
  '  description: "Counts the isolates that evaluate this module.",',
  "  inputSchema: z.object({}),",
  '  execute: async () => "ok",',
  "});",
].join("\n");

/** How many times the probe tool's module has been evaluated in this isolate. */
function probeEvaluations(): unknown {
  return (globalThis as Record<string, unknown>)[PROBE_KEY];
}

async function prepareDevelopmentHost(appRoot: string): Promise<PreparedDevelopmentHost> {
  const { prepareDevelopmentApplicationHost } = await loadEveInternal<{
    prepareDevelopmentApplicationHost: PrepareDevelopmentApplicationHost;
  }>("dist/src/internal/nitro/host/prepare-application-host.js");
  return await prepareDevelopmentApplicationHost(appRoot);
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[PROBE_KEY];
  for (const appRoot of fixtures.splice(0)) rmSync(appRoot, { force: true, recursive: true });
});

describe("eve dev compile isolation (#684)", () => {
  it("compiles authored modules without evaluating them in the dev host", async () => {
    const appRoot = createFixtureApp({ "agent/tools/probe.ts": probeTool });

    const host = await prepareDevelopmentHost(appRoot);

    expect(host.compileResult.manifest.tools.map((tool) => tool.name)).toContain("probe");
    expect(probeEvaluations()).toBeUndefined();
  }, 60_000);

  // A worker thread would also hide the modules from this isolate, but every
  // thread that loads Rolldown's native binding starts a thread pool it never
  // stops, so each rebuild leaked threads and their allocator arenas instead.
  it.runIf(process.platform === "linux")(
    "leaves no threads behind in the dev host across rebuilds",
    async () => {
      const appRoot = createFixtureApp({ "agent/tools/probe.ts": probeTool });
      const threadCount = () => readdirSync("/proc/self/task").length;

      await prepareDevelopmentHost(appRoot);
      const afterFirstCompile = threadCount();
      await prepareDevelopmentHost(appRoot);
      await prepareDevelopmentHost(appRoot);

      expect(threadCount()).toBe(afterFirstCompile);
    },
    60_000,
  );

  it("keeps compile diagnostics as a CompileAgentError with its result", async () => {
    const appRoot = createFixtureApp({ "agent/instructions.md": null });
    const { CompileAgentError } = await loadEveInternal<{
      CompileAgentError: CompileAgentErrorClass;
    }>("dist/src/compiler/compile-agent.js");

    const failure = await prepareDevelopmentHost(appRoot).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CompileAgentError);
    const { diagnostics } = (failure as CompileAgentFailure).result;
    expect(diagnostics.some(({ severity }) => severity === "error")).toBe(true);
  }, 60_000);

  it("keeps an authored module evaluation failure's message and cause", async () => {
    const appRoot = createFixtureApp({
      "agent/tools/throws.ts":
        'throw new TypeError("probe evaluation failed");\nexport default {};',
    });

    const failure = (await prepareDevelopmentHost(appRoot).catch(
      (error: unknown) => error,
    )) as Error;

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/^Failed to evaluate authored module:\n.*throws\.ts$/);
    expect(failure.cause).toBeInstanceOf(TypeError);
    expect((failure.cause as TypeError).message).toBe("probe evaluation failed");
  }, 60_000);

  // The compiler is a process the dev host owns; a host killed without running
  // its shutdown hooks must not leave one behind.
  it.runIf(process.platform !== "win32")(
    "ends the compile process when the dev host dies",
    async () => {
      const childEntry = join(eveRoot, "dist/src/internal/nitro/host/isolated-compile-child.js");
      const host = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          [
            'import { fork } from "node:child_process";',
            `const child = fork(${JSON.stringify(childEntry)}, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });`,
            "console.log(child.pid);",
            'setTimeout(() => process.kill(process.pid, "SIGKILL"), 500);',
          ].join("\n"),
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      let output = "";
      host.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      await new Promise((resolve) => host.once("exit", resolve));
      const compilePid = Number(output.trim());
      expect(compilePid).toBeGreaterThan(0);

      await expect.poll(() => isRunning(compilePid), { timeout: 5_000 }).toBe(false);
    },
    30_000,
  );
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
