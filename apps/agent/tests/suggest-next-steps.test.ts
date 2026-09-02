import { describe, expect, it } from "vitest";
import tool from "../agent/tools/suggest_next_steps";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

/**
 * The chip strip is the one place the model writes UI, and the one tool whose
 * failure lands on the user rather than on the turn.
 *
 * Everything here is about the two halves of that. The accepting half: a chip is a
 * fixed-width control in a row of three, so a model that returns six suggestions or
 * one long sentence must not produce a broken strip. The refusing half: the tool
 * reads nothing, writes nothing, and hands back a filtered copy of its own input,
 * so a call can never become a way to reach a record.
 */
const suggestNextSteps = asTestTool(tool);

/** eve parses input through the tool's own schema before `execute` ever runs. */
function run(suggestions: unknown) {
  return suggestNextSteps.execute(
    parseToolInput(suggestNextSteps, { suggestions }),
    undefined as never,
  );
}

/** eve's public `inputSchema` type is opaque; at runtime it is the zod schema. */
function parses(suggestions: unknown): boolean {
  const schema = tool.inputSchema as unknown as {
    safeParse: (value: unknown) => { success: boolean };
  };
  return schema.safeParse({ suggestions }).success;
}

describe("suggest_next_steps: the accepted list is the strip", () => {
  it("echoes back well-formed suggestions in the order the model gave them", async () => {
    const suggestions = [
      "Draft a birthday text to Casey",
      "Reopen the snoozed follow-up for Priya",
      "Show what else is due this week",
    ];

    expect(await run(suggestions)).toEqual({ suggestions });
  });

  it("truncates to three rather than failing the call", async () => {
    // A fourth chip has nowhere to go, and a thrown error at the end of a finished
    // answer would put a red result under a reply that was otherwise correct.
    const output = await run([
      "Draft a note to Casey",
      "Snooze the Priya reminder",
      "List this week's reminders",
      "Open the gift plan for Mara",
      "Add a reminder for Sam",
    ]);

    expect(output.suggestions).toEqual([
      "Draft a note to Casey",
      "Snooze the Priya reminder",
      "List this week's reminders",
    ]);
  });

  it("drops what cannot be a chip and keeps what can", async () => {
    const output = await run([
      "   ",
      "Priya",
      "Draft a warm, unhurried, carefully hedged message to Casey about the thing",
      "Ask whether the roofer ever came back with the revised quote for the garage",
      "Draft a note to Casey",
    ]);

    // Empty, one word, over sixty characters, over ten words - then the one usable
    // suggestion, which survives its neighbours rather than being lost with them.
    expect(output.suggestions).toEqual(["Draft a note to Casey"]);
  });

  it("normalizes wrapped whitespace and trailing punctuation instead of dropping", async () => {
    // A suggestion that is right in every way but ends in a period is worth keeping;
    // a question mark is not trailing noise, it is the sentence.
    const output = await run(["Draft a note\n  to Casey.", "What else is due this week?"]);

    expect(output.suggestions).toEqual(["Draft a note to Casey", "What else is due this week?"]);
  });

  it("keeps one chip when the model repeats itself in different case", async () => {
    const output = await run(["Draft a note to Casey", "draft a note to casey"]);

    expect(output.suggestions).toEqual(["Draft a note to Casey"]);
  });

  it("returns an empty strip when nothing survives", async () => {
    expect(await run(["Priya", "  "])).toEqual({ suggestions: [] });
  });

  it("requires at least one suggestion, and takes only strings", () => {
    expect(parses(["Draft a note to Casey"])).toBe(true);
    expect(parses([])).toBe(false);
    expect(parses("Draft a note to Casey")).toBe(false);
    expect(parses([{ text: "Draft a note to Casey" }])).toBe(false);
  });
});

describe("suggest_next_steps: the model reads a receipt, not its own words", () => {
  it("returns the count and the do-not-restate rule, and no suggestions", async () => {
    const output = await run(["Draft a note to Casey", "Snooze the Priya reminder"]);

    expect(toolModelValue(tool, output)).toEqual({
      ok: true,
      count: 2,
      guidance: "Do not restate the suggestions in prose.",
    });
  });

  it("says plainly when the strip ended up empty, so a retry is not invited", async () => {
    const value = toolModelValue(tool, await run(["Priya"]));

    expect(value.count).toBe(0);
    expect(value.guidance).toMatch(/user sees none/i);
    expect(value.guidance).toMatch(/do not call this again/i);
  });
});

describe("suggest_next_steps: presentation only", () => {
  it("reaches no store, no session, and no owner", async () => {
    // `execute` takes its input and nothing else. Passing a context that would throw
    // on any property read pins that: a tool that never touches `ctx` cannot grow a
    // read through it without this failing first.
    const hostileCtx = new Proxy(
      {},
      {
        get() {
          throw new Error("suggest_next_steps must not read the tool context");
        },
      },
    ) as never;

    await expect(
      suggestNextSteps.execute(
        parseToolInput(suggestNextSteps, { suggestions: ["Draft a note to Casey"] }),
        hostileCtx,
      ),
    ).resolves.toEqual({ suggestions: ["Draft a note to Casey"] });
  });

  it("tells the model when to call it, and that it is not a durable proposal", () => {
    const { description } = tool as { description: string };

    expect(description).toMatch(/one to three/i);
    expect(description).toMatch(/last tool call of a substantive answer/i);
    expect(description).toMatch(/never hand the user back their own last message/i);
    expect(description).toMatch(/skip it entirely/i);
    expect(description).toMatch(/`suggest_general_action`/);
    // A read that says it might park teaches the model to ask before acting
    // everywhere (see `write-tool-approval.test.ts`); this one never parks at all.
    expect(description).not.toMatch(/\bpauses?\b/i);
  });
});
