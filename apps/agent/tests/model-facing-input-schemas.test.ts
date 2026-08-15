import { describe, expect, it } from "vitest";
import archiveSelfContextTool from "../agent/tools/archive_self_context";
import restoreSelfContextTool from "../agent/tools/restore_self_context";
import saveDraftToGmailTool from "../agent/tools/save_draft_to_gmail";
import updateFollowupStatusTool from "../agent/tools/update_followup_status";
import updateSelfContextTool from "../agent/tools/update_self_context";

/**
 * A tool's input schema is an instruction, not a formality: it is the only text the
 * model reads per argument, and the only place an invalid call can be stopped before
 * it writes something. These pin the constraints that used to live in prose (or
 * nowhere) and were learned from a thrown error after the fact.
 */
type ParseResult = {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
};

/** Eve's public `inputSchema` type is opaque; at runtime it is the zod schema. */
function parser(tool: { inputSchema: unknown }) {
  return tool.inputSchema as { safeParse: (value: unknown) => ParseResult };
}

function describeOf(tool: { inputSchema: unknown }, field: string): string {
  const shape = (tool.inputSchema as { shape?: Record<string, { description?: string }> }).shape;
  return shape?.[field]?.description ?? "";
}

const FOLLOWUP_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const FACT_ID = "33333333-3333-4333-8333-333333333333";

describe("update_followup_status: dueAt belongs to exactly one transition", () => {
  it("rejects a snooze with no new due date, naming the field", () => {
    const parsed = parser(updateFollowupStatusTool).safeParse({
      followupId: FOLLOWUP_ID,
      status: "snooze",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["dueAt"]);
    expect(parsed.error?.issues[0]?.message).toMatch(/needs a new due date/i);
    expect(parsed.error?.issues[0]?.message).toMatch(/iso 8601/i);
  });

  it("rejects a due date on any other status, and says what it would have done", () => {
    // The dangerous half: "push Alex's reminder to next week" sent as
    // `{complete, dueAt}` used to parse, drop the date, and complete the reminder.
    const parsed = parser(updateFollowupStatusTool).safeParse({
      followupId: FOLLOWUP_ID,
      status: "complete",
      dueAt: "2026-09-01T00:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/would have applied "complete"/i);
    expect(parsed.error?.issues[0]?.message).toMatch(/use status "snooze"/i);
  });

  it("accepts each transition in its one valid shape", () => {
    expect(
      parser(updateFollowupStatusTool).safeParse({
        followupId: FOLLOWUP_ID,
        status: "snooze",
        dueAt: "2026-09-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      parser(updateFollowupStatusTool).safeParse({ followupId: FOLLOWUP_ID, status: "complete" })
        .success,
    ).toBe(true);
  });
});

describe("save_draft_to_gmail: the recipient is an address", () => {
  const valid = { draftId: DRAFT_ID, recipientEmail: "alex@example.com", subject: "Catching up" };

  it("rejects a name, which the old three-character floor accepted", () => {
    // This is the one field on the one tool that reaches outside Tendnote. `min(3)`
    // let "Alex" through to the Gmail adapter.
    expect(
      parser(saveDraftToGmailTool).safeParse({ ...valid, recipientEmail: "Alex" }).success,
    ).toBe(false);
    expect(
      parser(saveDraftToGmailTool).safeParse({ ...valid, recipientEmail: "alex@" }).success,
    ).toBe(false);
  });

  it("accepts a real address", () => {
    expect(parser(saveDraftToGmailTool).safeParse(valid).success).toBe(true);
  });
});

/**
 * Optimistic concurrency the model can actually use.
 *
 * The stamps were optional, undocumented, and - before the read tools started
 * carrying `updatedAt` - unobtainable, so they were simply never passed and a
 * correction could overwrite an edit the user had made in the app since. The rule
 * only bites if the field says where its value comes from.
 */
describe("self context: the concurrency stamps say where to get them", () => {
  it.each([
    ["update_self_context", updateSelfContextTool],
    ["archive_self_context", archiveSelfContextTool],
  ] as const)("%s points expectedUpdatedAt at the read that returned it", (_name, tool) => {
    const description = describeOf(tool, "expectedUpdatedAt");

    expect(description).toMatch(/list_self_context/);
    expect(description).toMatch(/get_self_context_fact/);
    expect(description).toMatch(/this conversation/i);
    expect(description).toMatch(/never compose a timestamp/i);
  });

  it("restore_self_context points expectedArchivedAt at the archive it undoes", () => {
    const description = describeOf(restoreSelfContextTool, "expectedArchivedAt");

    expect(description).toMatch(/archive_self_context/);
    expect(description).toMatch(/this conversation/i);
    expect(description).toMatch(/never compose a timestamp/i);
  });

  it("still accepts a call without a stamp, so a stale id is read rather than refused", () => {
    // Deliberately optional: an id carried over from an earlier session has no stamp,
    // and refusing it would strand the user rather than protect them.
    expect(parser(archiveSelfContextTool).safeParse({ contextFactId: FACT_ID }).success).toBe(true);
    expect(parser(restoreSelfContextTool).safeParse({ contextFactId: FACT_ID }).success).toBe(true);
  });
});
