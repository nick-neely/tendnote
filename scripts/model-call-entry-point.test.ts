import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

/**
 * The model-call entry point (spec #591, ADR 0246). It is the only module that
 * may build, wrap, or route to a provider model; every other hosted call takes
 * its model from `hostedModel` or `hostedEmbeddingModel`.
 */
const ENTRY_POINT = "packages/db/src/queries/model-calls.ts";

/** Production source: what hosted Eve, the web app, and background jobs run. */
const SOURCE_ROOTS = ["apps/agent/agent", "apps/web/src", ...workspaceSourceRoots("packages")];

/** AI SDK exports that call a model. Each call must pass an entry-point model inline. */
const AI_SDK_MODEL_CALLERS = new Set([
  "embed",
  "embedMany",
  "generateObject",
  "generateText",
  "streamObject",
  "streamText",
]);

/**
 * AI SDK value exports that never reach a model. Anything else, including a
 * gateway, a provider registry, a model wrapper, or an agent class, belongs in
 * the entry point; add an export here only if it cannot call a model.
 */
const AI_SDK_HELPERS = new Set(["Output", "jsonSchema", "stepCountIs", "tool"]);

const ENTRY_POINT_MODEL = /^\s*hosted(?:Embedding)?Model\(/;
const MODEL_SDK_SPECIFIER = /^(?:ai|ai\/.+|@ai-sdk\/.+)$/;
/** The AI SDK's mock models, for test support; they cannot reach a provider. */
const AI_SDK_MOCKS = "ai/test";

function workspaceSourceRoots(dir: string) {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}/src`);
}

function sourceFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "tests" ? [] : sourceFiles(path);
    }
    return /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

type ImportedName = { imported: string; local: string };
type ModuleImport = { specifier: string; namespace: boolean; names: ImportedName[] };

/** Value imports and re-exports, with type-only ones dropped. */
function valueImports(source: string): ModuleImport[] {
  const statements = source.matchAll(
    /\b(?:import|export)\s+(type\s+)?([\w$\s{},*]*?)\s*from\s*["']([^"']+)["']/g,
  );
  return [...statements].flatMap(([, typeOnly, clause = "", specifier = ""]) => {
    if (typeOnly) return [];
    const braced = clause.match(/\{([^}]*)\}/)?.[1];
    const names = (braced ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("type "))
      .map((part) => {
        const [imported = "", local = imported] = part.split(/\s+as\s+/);
        return { imported, local };
      });
    const outside = clause.replace(/\{[^}]*\}/, "").trim();
    const namespace = outside.includes("*");
    const defaultName = outside.replace(/[*,]|\bas\s+[\w$]+/g, "").trim();
    if (defaultName) names.push({ imported: "default", local: defaultName });
    return namespace || names.length ? [{ specifier, namespace, names }] : [];
  });
}

function skipString(source: string, start: number) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === quote) return i;
  }
  return source.length;
}

/** The text between a call's parentheses, skipping strings and comments. */
function callArguments(source: string, open: number) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i] ?? "";
    if (char === '"' || char === "'" || char === "`") i = skipString(source, i);
    else if (source.startsWith("//", i)) i = source.indexOf("\n", i) >>> 0;
    else if (source.startsWith("/*", i)) i = (source.indexOf("*/", i) >>> 0) + 1;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char) && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

/** Whether every call to `name` passes an entry-point model as its `model` option. */
function callsWithoutEntryPointModel(source: string, name: string) {
  const escaped = name.replace(/\$/g, "\\$");
  const calls = [...source.matchAll(new RegExp(`(?<![\\w$.])${escaped}\\s*\\(`, "g"))];
  const unpinned = calls.filter((call) => {
    const args = callArguments(source, (call.index ?? 0) + call[0].length - 1);
    const models = [...args.matchAll(/\bmodel\s*:/g)];
    return (
      models.length === 0 ||
      models.some((model) => !ENTRY_POINT_MODEL.test(args.slice(model.index + model[0].length)))
    );
  });
  return { calls: calls.length, unpinned: unpinned.length };
}

/**
 * Every way a module could reach a model without the entry point, and the
 * number of model calls it checked.
 */
function modelCallViolations(source: string) {
  const violations: string[] = [];
  let checkedCalls = 0;
  const checkCalls = (name: string, what: string) => {
    const { calls, unpinned } = callsWithoutEntryPointModel(source, name);
    checkedCalls += calls;
    if (unpinned) {
      violations.push(`${what} is called without \`model: hostedModel(...)\` inline`);
    }
  };

  if (/\b(?:import|require)\s*\(\s*["'](?:ai|@ai-sdk\/)/.test(source)) {
    violations.push("loads the AI SDK dynamically");
  }
  for (const { specifier, namespace, names } of valueImports(source)) {
    if (specifier === "eve") {
      for (const { imported, local } of names) {
        if (imported === "defineAgent") checkCalls(local, "Eve's defineAgent");
      }
    }
    if (!MODEL_SDK_SPECIFIER.test(specifier) || specifier === AI_SDK_MOCKS) continue;
    if (specifier !== "ai" || namespace) {
      violations.push(`imports ${namespace ? "all of " : ""}"${specifier}"`);
      continue;
    }
    for (const { imported, local } of names) {
      if (AI_SDK_MODEL_CALLERS.has(imported)) checkCalls(local, `the AI SDK's ${imported}`);
      else if (!AI_SDK_HELPERS.has(imported)) violations.push(`imports ${imported} from "ai"`);
    }
  }
  return { violations, checkedCalls };
}

describe("the model-call completeness check", () => {
  const passes = (source: string) => expect(modelCallViolations(source).violations).toEqual([]);
  const fails = (source: string, violation: string | RegExp) =>
    expect(modelCallViolations(source).violations).toContainEqual(
      typeof violation === "string" ? violation : expect.stringMatching(violation),
    );

  it("accepts calls that take their model from the entry point", () => {
    passes(`
      import { generateText, Output } from "ai";
      import { hostedModel } from "../model-calls";
      const { text } = await generateText({
        model: hostedModel({ modelId, costCategory: "background" }),
        output: Output.object({ schema }),
        prompt: \`Summarize (briefly) the \${"notes"}\`,
      });
    `);
    passes(`
      import { embed } from "ai";
      await embed({ model: hostedEmbeddingModel({ modelId, costCategory: "background" }), value });
    `);
    passes(`
      import { defineAgent } from "eve";
      export default defineAgent({
        model: hostedModel({ modelId: "google/x", costCategory: "interactive" }),
        modelOptions: { providerOptions: {} },
      });
    `);
    passes(`import type { UIMessage } from "ai";\nimport { type ChatStatus } from "ai";`);
    passes(`import { MockLanguageModelV4 } from "ai/test";`);
  });

  it("rejects a module that constructs a gateway or provider model", () => {
    fails(`import { gateway, generateText } from "ai";`, 'imports gateway from "ai"');
    fails(`import { createGateway } from "ai";`, 'imports createGateway from "ai"');
    fails(`import { wrapLanguageModel } from "ai";`, 'imports wrapLanguageModel from "ai"');
    fails(`import { google } from "@ai-sdk/google";`, 'imports "@ai-sdk/google"');
    fails(`import { vertex } from '@ai-sdk/google-vertex/edge';`, /@ai-sdk\/google-vertex/);
    fails(`import * as ai from "ai";`, 'imports all of "ai"');
    fails(`import { gateway } from "ai/internal";`, 'imports "ai/internal"');
    fails(`const { gateway } = await import("ai");`, "loads the AI SDK dynamically");
    fails(`export { gateway } from "ai";`, 'imports gateway from "ai"');
  });

  it("rejects an AI SDK export it does not know cannot call a model", () => {
    fails(`import { ToolLoopAgent } from "ai";`, 'imports ToolLoopAgent from "ai"');
    fails(`import { generateImage } from "ai";`, 'imports generateImage from "ai"');
  });

  it("rejects a model call whose model is not an entry-point model", () => {
    const unpinned = /the AI SDK's generateText is called without/;
    fails(
      `import { generateText } from "ai";\ngenerateText({ model: "google/x", prompt });`,
      unpinned,
    );
    fails(`import { generateText } from "ai";\ngenerateText({ model, prompt });`, unpinned);
    fails(`import { generateText } from "ai";\ngenerateText(options);`, unpinned);
    fails(
      `import { generateText as run } from "ai";\nrun({ model: gateway("google/x") });`,
      /the AI SDK's generateText/,
    );
    fails(
      `import { generateText } from "ai";\ngenerateText({ model: hostedModel(input) });\ngenerateText({ model: other });`,
      unpinned,
    );
    fails(`import { embed } from "ai";\nembed({ model: "openai/x", value });`, /embed is called/);
  });

  it("rejects an Eve agent without an entry-point model", () => {
    const unpinned = "Eve's defineAgent is called without `model: hostedModel(...)` inline";
    fails(`import { defineAgent } from "eve";\ndefineAgent({ model: "google/x" });`, unpinned);
    fails(`import { defineAgent } from "eve";\ndefineAgent({ description: "d" });`, unpinned);
  });
});

describe("hosted model calls", () => {
  const files = SOURCE_ROOTS.flatMap(sourceFiles).filter((file) => file !== ENTRY_POINT);
  const scans = files.map((file) => {
    const source = readFileSync(join(root, file), "utf8");
    return { file, source, ...modelCallViolations(source) };
  });

  it("scans the production source roots", () => {
    expect(files).toContain("apps/agent/agent/agent.ts");
    expect(files).toContain("apps/web/src/components/assistant-panel.tsx");
    expect(files).toContain("packages/db/src/queries/drafts.ts");
    expect(files.some((file) => file.includes("/tests/") || file.includes(".test."))).toBe(false);
  });

  it("reach a model only through the entry point", () => {
    const violations = scans.flatMap(({ file, violations }) =>
      violations.map((violation) => `${relative(root, join(root, file))}: ${violation}`),
    );
    expect(violations).toEqual([]);
  });

  it("checks a model call in every module that uses the entry point", () => {
    // Keeps the check honest: a module that imports an entry-point model but
    // has no call the scan recognizes means the scan has a blind spot.
    const usesEntryPoint = scans
      .filter(({ source }) => /\bhosted(?:Embedding)?Model\b/.test(source))
      .map(({ file }) => file);
    const checked = scans.filter(({ checkedCalls }) => checkedCalls > 0).map(({ file }) => file);
    expect(usesEntryPoint.length).toBeGreaterThan(10);
    expect(checked).toEqual(usesEntryPoint);
  });
});
