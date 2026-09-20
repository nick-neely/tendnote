import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { jsonSchema } from "ai";
import { mockModel } from "eve/evals";
import { expect, it } from "vitest";

// Exercise the installed runtime, including the pnpm patch, without a provider.
const require = createRequire(import.meta.url);
const entry = require.resolve("eve");
const { createToolLoopHarness } = await import(
  pathToFileURL(resolve(dirname(entry), "harness/tool-loop.js")).href
);

it.each(["after lookup", "after capture"])(
  "empty-response recovery %s preserves exactly one capture",
  async (emptyAt) => {
    const calls = [];
    let emptied = false;
    const recoveryNotes = [];
    const model = mockModel(({ messages, toolResults }) => {
      const recoveryNote = readRecoveryNote(messages);
      recoveryNotes.push(recoveryNote);
      if (!toolResults.length) return { toolCalls: [{ name: "search_people" }] };
      const captured = toolResults.some((r) => r.name === "capture_source_record");
      if (shouldEmpty(emptied, emptyAt, captured)) {
        emptied = true;
        return { text: "" };
      }
      if (captured) return "Saved.";
      // Model fixture follows the observed interpretation of the old instruction.
      // This tests the runtime instruction contract, not real-model reliability.
      return unfinishedCapture(recoveryNote);
    });
    const tools = new Map(
      ["search_people", "capture_source_record"].map((name) => [
        name,
        {
          name,
          description: name,
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute: async () => {
            calls.push(name);
            return { personId: "person", ok: true };
          },
        },
      ]),
    );
    let step = createToolLoopHarness({
      mode: "conversation",
      handleEvent: async () => {},
      tools,
      resolveModel: async () => model,
    });
    let session = {
      agent: {
        system: "Log the requested private note. Resolve its person first.",
        tools: [],
        modelReference: { id: "fixture" },
      },
      compaction: { threshold: 1000000, recentWindowSize: 10 },
      continuationToken: "fixture",
      sessionId: "capture-recovery",
      history: [],
    };
    for (let i = 0; i < 8; i++) {
      const result = await step(
        session,
        i === 0 ? { message: "Log a private note for Avery Bdley: enjoys pottery." } : undefined,
      );
      session = result.session;
      if (typeof result.next !== "function") break;
      step = result.next;
    }
    expect(emptied).toBe(true);
    expect(calls).toEqual(["search_people", "capture_source_record"]);
    expect(recoveryNotes.some((note) => note.includes("not yet completed"))).toBe(true);
  },
);

function readRecoveryNote(messages) {
  return messages.findLast((m) => m.text.includes("previous reply was empty"))?.text ?? "";
}
function shouldEmpty(emptied, emptyAt, captured) {
  if (emptied) return false;
  return emptyAt === "after lookup" || captured;
}
function unfinishedCapture(recoveryNote) {
  if (recoveryNote.includes("do not re-run tools")) return "Should I save the note?";
  return { toolCalls: [{ name: "capture_source_record" }] };
}
