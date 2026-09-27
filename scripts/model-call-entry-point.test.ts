import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSync } from "rolldown/utils";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

/**
 * The model-call entry point (spec #591, ADR 0246). It is the only module that
 * may build, wrap, or route to a provider model; every other hosted call takes
 * its model from `hostedModel` or `hostedEmbeddingModel`.
 */
const ENTRY_POINT = "packages/db/src/queries/model-calls.ts";
const ENTRY_POINT_SPECIFIER = /(?:^|\/)model-calls$/;
const ENTRY_POINT_MODELS = new Set(["hostedModel", "hostedEmbeddingModel"]);

/**
 * Production source: what hosted Eve, the web app, and background jobs run.
 * Tests, evals, and local scripts are left out; they use mock models or drive
 * Eve itself.
 */
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

const MODEL_SDK_SPECIFIER = /^(?:ai|ai\/.+|@ai-sdk\/.+)$/;
/** The AI SDK's mock models, for test support; they cannot reach a provider. */
const AI_SDK_MOCKS = "ai/test";

/** TypeScript-only subtrees: a name there is a type position, not a reference. */
const TYPE_ONLY_NODES = new Set([
  "TSTypeAnnotation",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
]);

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

/** An ESTree node, read loosely; only the fields this check needs are named. */
type Node = { type: string } & Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";
const child = (node: Node, key: string) => (isNode(node[key]) ? (node[key] as Node) : undefined);
const children = (node: Node, key: string) => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};
const nameOf = (node: Node | undefined) => (node?.name ?? node?.value) as string | undefined;

/** Every node with its parent, skipping type-only subtrees and export-from lists. */
function* walk(node: Node, parent?: Node): Generator<[Node, Node | undefined]> {
  yield [node, parent];
  if (TYPE_ONLY_NODES.has(node.type) || (node.type === "ExportNamedDeclaration" && node.source)) {
    return;
  }
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isNode(item)) yield* walk(item, node);
    }
  }
}

/** Whether an identifier names a binding, as opposed to a key, member, or import slot. */
function isReference(node: Node, parent: Node | undefined) {
  if (!parent) return true;
  const nonComputedKey =
    ["MemberExpression", "Property", "PropertyDefinition", "MethodDefinition"].includes(
      parent.type,
    ) &&
    !parent.computed &&
    (parent.property === node || parent.key === node);
  return !nonComputedKey && !parent.type.startsWith("Import");
}

/**
 * Whether a call passes, as its options object, exactly one `model` whose value
 * is a one-argument entry-point call. A spread could override the model and a
 * second argument would inject another provider, so both fail.
 */
function takesEntryPointModel(call: Node, entryPointLocals: Set<string>) {
  const options = children(call, "arguments")[0];
  if (options?.type !== "ObjectExpression") return false;
  const models = children(options, "properties").filter(
    (property) =>
      property.type === "SpreadElement" ||
      (!property.computed && nameOf(child(property, "key")) === "model"),
  );
  const model = models.length === 1 ? child(models[0] as Node, "value") : undefined;
  return (
    model?.type === "CallExpression" &&
    entryPointLocals.has(nameOf(child(model, "callee")) ?? "") &&
    children(model, "arguments").length === 1
  );
}

type Checked = { what: string };

/** Collects every import-level violation and the names whose uses must be checked. */
function readImports(program: Node, violations: string[]) {
  const checked = new Map<string, Checked>();
  const entryPointLocals = new Set<string>();
  let usesEntryPoint = false;

  for (const statement of children(program, "body")) {
    const source = nameOf(child(statement, "source"));
    if (!source || statement.importKind === "type" || statement.exportKind === "type") continue;
    const reexport = statement.type !== "ImportDeclaration";
    const specifiers = children(statement, "specifiers");
    const named = specifiers
      .filter((specifier) => specifier.importKind !== "type" && specifier.exportKind !== "type")
      .map((specifier) => ({
        kind: specifier.type,
        imported: nameOf(child(specifier, reexport ? "local" : "imported")) ?? "default",
        local: nameOf(child(specifier, reexport ? "exported" : "local")) ?? "",
      }));

    if (ENTRY_POINT_SPECIFIER.test(source)) {
      usesEntryPoint = true;
      for (const { imported, local } of named) {
        if (ENTRY_POINT_MODELS.has(imported)) entryPointLocals.add(local);
      }
    }
    if (source === "eve") {
      for (const { kind, imported, local } of named) {
        if (kind !== "ImportSpecifier") violations.push('imports all of "eve"');
        if (imported === "defineAgent") checked.set(local, { what: "Eve's defineAgent" });
      }
    }
    if (!MODEL_SDK_SPECIFIER.test(source) || source === AI_SDK_MOCKS || !named.length) {
      if (statement.type === "ExportAllDeclaration" && MODEL_SDK_SPECIFIER.test(source)) {
        violations.push(`re-exports all of "${source}"`);
      }
      continue;
    }
    if (source !== "ai") {
      violations.push(`imports "${source}"`);
      continue;
    }
    for (const { kind, imported, local } of named) {
      if (kind === "ImportNamespaceSpecifier") violations.push('imports all of "ai"');
      else if (AI_SDK_HELPERS.has(imported)) continue;
      else if (!reexport && AI_SDK_MODEL_CALLERS.has(imported)) {
        checked.set(local, { what: `the AI SDK's ${imported}` });
      } else violations.push(`${reexport ? "re-exports" : "imports"} ${imported} from "ai"`);
    }
  }
  return { checked, entryPointLocals, usesEntryPoint };
}

/**
 * Every way a module could reach a model without the entry point, the number
 * of model calls it checked, and whether it imports the entry point.
 */
function modelCallViolations(file: string, source: string) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length) {
    return { violations: ["does not parse"], checkedCalls: 0, usesEntryPoint: false };
  }
  const program = parsed.program as unknown as Node;
  const violations: string[] = [];
  const { checked, entryPointLocals, usesEntryPoint } = readImports(program, violations);
  let checkedCalls = 0;

  for (const [node, parent] of walk(program)) {
    const loaded = nameOf(child(node, "source")) ?? nameOf(children(node, "arguments")[0]);
    const loads =
      node.type === "ImportExpression" ||
      (node.type === "CallExpression" && nameOf(child(node, "callee")) === "require");
    if (loads && loaded && MODEL_SDK_SPECIFIER.test(loaded) && loaded !== AI_SDK_MOCKS) {
      violations.push("loads the AI SDK dynamically");
    }

    const target = node.type === "Identifier" ? checked.get(nameOf(node) ?? "") : undefined;
    if (!target || !isReference(node, parent)) continue;
    const called =
      (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
      parent.callee === node;
    if (!called) violations.push(`${target.what} is used other than by calling it`);
    else if (!takesEntryPointModel(parent as Node, entryPointLocals)) {
      violations.push(`${target.what} is called without \`model: hostedModel(...)\` inline`);
    } else checkedCalls++;
  }
  return { violations, checkedCalls, usesEntryPoint };
}

describe("the model-call completeness check", () => {
  const violationsOf = (source: string) => modelCallViolations("fixture.ts", source).violations;
  const passes = (source: string) => expect(violationsOf(source)).toEqual([]);
  const fails = (source: string, violation: string | RegExp) =>
    expect(violationsOf(source)).toContainEqual(
      typeof violation === "string" ? violation : expect.stringMatching(violation),
    );
  const aiCaller = `import { generateText } from "ai";\nimport { hostedModel } from "../model-calls";\n`;
  const unpinned = /the AI SDK's generateText is called without/;

  it("accepts calls that take their model from the entry point", () => {
    passes(`${aiCaller}
      const { text } = await generateText({
        model: hostedModel({ modelId, costCategory: "background" }),
        prompt: \`Summarize (briefly) the \${"notes"}\`,
        pattern: /\\(/,
      });
    `);
    passes(`
      import { embed, Output } from "ai";
      import { hostedEmbeddingModel as embeddings } from "@tendnote/db/queries/model-calls";
      await embed({ model: embeddings({ modelId, costCategory: "background" }), value });
    `);
    passes(`
      import { defineAgent } from "eve";
      import { hostedModel } from "@tendnote/db/queries/model-calls";
      export default defineAgent({
        model: hostedModel({ modelId: "google/x", costCategory: "interactive" }),
        modelOptions: { providerOptions: {} },
      });
    `);
    passes(`
      import type { UIMessage } from "ai";
      import { type ChatStatus } from "ai";
      import { MockLanguageModelV4 } from "ai/test";
      type Generate = typeof generateText;
      const labels = { generateText: "x" };
    `);
  });

  it("rejects a module that constructs a gateway or provider model", () => {
    fails(`import { gateway, generateText } from "ai";`, 'imports gateway from "ai"');
    fails(`import { createGateway } from "ai";`, 'imports createGateway from "ai"');
    fails(`import {\n  // model builders\n  gateway,\n} from "ai";`, 'imports gateway from "ai"');
    fails(`import { wrapLanguageModel } from "ai";`, 'imports wrapLanguageModel from "ai"');
    fails(`import { google } from "@ai-sdk/google";`, 'imports "@ai-sdk/google"');
    fails(`import { gateway } from "ai/internal";`, 'imports "ai/internal"');
    fails(`import * as ai from "ai";`, 'imports all of "ai"');
    fails(`import ai from "ai";`, 'imports default from "ai"');
    fails(`const { gateway } = await import("ai");`, "loads the AI SDK dynamically");
    fails(`const { google } = require("@ai-sdk/google");`, "loads the AI SDK dynamically");
    fails(`export { gateway } from "ai";`, 're-exports gateway from "ai"');
    fails(`export { generateText } from "ai";`, 're-exports generateText from "ai"');
    fails(`export * from "ai";`, 're-exports all of "ai"');
  });

  it("rejects an AI SDK export it does not know cannot call a model", () => {
    fails(`import { ToolLoopAgent } from "ai";`, 'imports ToolLoopAgent from "ai"');
    fails(`import { generateImage } from "ai";`, 'imports generateImage from "ai"');
  });

  it("rejects a model call whose model is not an entry-point model", () => {
    fails(`${aiCaller}generateText({ model: "google/x", prompt });`, unpinned);
    fails(`${aiCaller}generateText({ model, prompt });`, unpinned);
    fails(`${aiCaller}generateText(options);`, unpinned);
    fails(`${aiCaller}generateText({ model: hostedModel(input), ...options });`, unpinned);
    fails(`${aiCaller}generateText({ model: hostedModel(input, provider) });`, unpinned);
    fails(`${aiCaller}generateText({ model: hostedModel(input) ?? other });`, unpinned);
    fails(
      `import { generateText } from "ai";\ngenerateText({ model: hostedModel(input) });`,
      unpinned,
    );
    fails(
      `${aiCaller}generateText({ model: hostedModel(i) });\ngenerateText({ model: other });`,
      unpinned,
    );
    fails(
      `import { generateText as run } from "ai";\nrun({ model: gateway("google/x") });`,
      /the AI SDK's generateText is called/,
    );
    fails(`import { embed } from "ai";\nembed({ model: "openai/x", value });`, /embed is called/);
  });

  it("rejects a model caller used other than by calling it", () => {
    const aliased = "the AI SDK's generateText is used other than by calling it";
    fails(`${aiCaller}const run = generateText;\nrun({ model: "google/x" });`, aliased);
    fails(`${aiCaller}generateText.call(null, { model: "google/x" });`, aliased);
    fails(`${aiCaller}export { generateText };`, aliased);
  });

  it("rejects an Eve agent without an entry-point model", () => {
    const unpinned = "Eve's defineAgent is called without `model: hostedModel(...)` inline";
    fails(`import { defineAgent } from "eve";\ndefineAgent({ model: "google/x" });`, unpinned);
    fails(`import { defineAgent } from "eve";\ndefineAgent({ description: "d" });`, unpinned);
    fails(`import * as eve from "eve";\neve.defineAgent({ model: "x" });`, 'imports all of "eve"');
  });
});

describe("hosted model calls", () => {
  const files = SOURCE_ROOTS.flatMap(sourceFiles).filter((file) => file !== ENTRY_POINT);
  const scans = files.map((file) => ({
    file,
    ...modelCallViolations(file, readFileSync(join(root, file), "utf8")),
  }));

  it("scans the production source roots", () => {
    expect(files).toContain("apps/agent/agent/agent.ts");
    expect(files).toContain("apps/web/src/components/assistant-panel.tsx");
    expect(files).toContain("packages/db/src/queries/drafts.ts");
    expect(files.some((file) => file.includes("/tests/") || file.includes(".test."))).toBe(false);
  });

  it("reach a model only through the entry point", () => {
    const violations = scans.flatMap(({ file, violations }) =>
      violations.map((violation) => `${file}: ${violation}`),
    );
    expect(violations).toEqual([]);
  });

  it("checks a model call in every module that uses the entry point", () => {
    // Keeps the check honest: a module that imports the entry point but has
    // no call the scan recognizes means the scan has a blind spot.
    const usesEntryPoint = scans.filter((scan) => scan.usesEntryPoint).map(({ file }) => file);
    const checked = scans.filter(({ checkedCalls }) => checkedCalls > 0).map(({ file }) => file);
    expect(usesEntryPoint.length).toBeGreaterThan(10);
    expect(checked).toEqual(usesEntryPoint);
  });
});
