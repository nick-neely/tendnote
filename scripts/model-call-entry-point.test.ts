import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTRY_POINT, modelCallViolations, productionSourceFiles } from "./model-call-boundary";

const root = resolve(import.meta.dirname, "..");

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
    fails("const { gateway } = await import(`ai`);", "loads the AI SDK dynamically");
    fails("const { google } = require(`@ai-sdk/google`);", "loads the AI SDK dynamically");
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
  const files = productionSourceFiles(root).filter((file) => file !== ENTRY_POINT);
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
