import {
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureUndoTargetSchema,
} from "@tendnote/domain/conversational-capture";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every describer is mocked at the query entry point it loads through, which is
 * the boundary this module is defined by: it may only see what an owner-scoped
 * read already answered. The doubles therefore stand in for the store, not for
 * the visibility rules — those stay where they are enforced.
 */
const stores = vi.hoisted(() => ({
  getAsset: vi.fn(),
  getAssetReviewGroup: vi.fn(),
  getDraft: vi.fn(),
  getFollowup: vi.fn(),
  getGeneralAction: vi.fn(),
  getGiftIdea: vi.fn(),
  getGiftPlan: vi.fn(),
  getMemory: vi.fn(),
  getPerson: vi.fn(),
  getSavedItem: vi.fn(),
  getSelfContextFact: vi.fn(),
}));

vi.mock("./assets", () => ({
  getAsset: stores.getAsset,
  getAssetReviewGroup: stores.getAssetReviewGroup,
}));
vi.mock("./context-facts", () => ({ getSelfContextFact: stores.getSelfContextFact }));
vi.mock("./drafts", () => ({ getDraft: stores.getDraft }));
vi.mock("./followups", () => ({ getFollowup: stores.getFollowup }));
vi.mock("./general-actions", () => ({ getGeneralAction: stores.getGeneralAction }));
vi.mock("./gift-plans", () => ({
  getGiftIdea: stores.getGiftIdea,
  getGiftPlan: stores.getGiftPlan,
}));
vi.mock("./memories", () => ({ getMemory: stores.getMemory }));
vi.mock("./people", () => ({ getPerson: stores.getPerson }));
vi.mock("./saved-items", () => ({ getSavedItem: stores.getSavedItem }));

const {
  APPROVAL_SUBJECT_LINE_MAX_LENGTH,
  APPROVAL_SUBJECT_TITLE_MAX_LENGTH,
  APPROVAL_SUBJECT_TOOL_NAMES,
  describeApprovalSubject,
} = await import("./approval-subjects");

const { APPROVAL_SUBJECT_BODY_MAX_LENGTH, APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH, paragraphs } =
  await import("./approval-subjects/define");

const OWNER = "user-1";
const FOLLOWUP_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const IDEA_ID = "44444444-4444-4444-8444-444444444444";
const MEMORY_ID = "55555555-5555-4555-8555-555555555555";

function describeFor(toolName: string, input: unknown, ownerUserId = OWNER) {
  return describeApprovalSubject({ ownerUserId, toolName, input });
}

beforeEach(() => vi.clearAllMocks());

describe("the registry's boundaries", () => {
  it("leaves a tool it has no describer for to render its own raw input", async () => {
    await expect(describeFor("create_person", { displayName: "Ana" })).resolves.toEqual({
      kind: "unknown-tool",
    });
  });

  it("names exactly the tools it can describe", async () => {
    // A drifted list is how a write tool quietly loses its description and the
    // owner is asked to approve a uuid.
    expect(APPROVAL_SUBJECT_TOOL_NAMES).toEqual([
      "accept_suggested_followup",
      "accept_suggested_general_action",
      "add_gift_idea",
      "approve_suggested_memory",
      "archive_memory",
      "archive_self_context",
      "capture_memory",
      "capture_source_record",
      "change_saved_item_capture",
      "create_followup",
      "dismiss_draft",
      "dismiss_suggested_followup",
      "dismiss_suggested_general_action",
      "dismiss_suggested_memory",
      "edit_asset",
      "edit_draft_body",
      "edit_general_action",
      "edit_gift_idea",
      "remove_gift_idea",
      "restore_self_context",
      "save_draft_to_gmail",
      "undo_saved_item_capture",
      "update_followup_status",
      "update_general_action_status",
      "update_person",
      "update_self_context",
    ]);
  });

  it("is missing when the input is not the shape the tool takes", async () => {
    await expect(describeFor("archive_memory", { memoryId: "not-a-uuid" })).resolves.toEqual({
      kind: "missing",
    });
    await expect(describeFor("archive_memory", undefined)).resolves.toEqual({ kind: "missing" });
    expect(stores.getMemory).not.toHaveBeenCalled();
  });

  it("is missing when the record does not resolve for this owner", async () => {
    stores.getMemory.mockResolvedValue(null);
    await expect(describeFor("archive_memory", { memoryId: MEMORY_ID })).resolves.toEqual({
      kind: "missing",
    });
  });

  it("is missing, not an exception, when the store is unreachable", async () => {
    stores.getMemory.mockRejectedValue(new Error("connection refused"));
    await expect(describeFor("archive_memory", { memoryId: MEMORY_ID })).resolves.toEqual({
      kind: "missing",
    });
  });

  it("refuses to look anything up without an owner", async () => {
    await expect(describeFor("archive_memory", { memoryId: MEMORY_ID }, "  ")).resolves.toEqual({
      kind: "missing",
    });
    expect(stores.getMemory).not.toHaveBeenCalled();
  });

  it("reads only inside the authenticated owner's scope", async () => {
    stores.getMemory.mockResolvedValue({ content: "Ana is moving in August" });
    await describeFor("archive_memory", { memoryId: MEMORY_ID });
    expect(stores.getMemory).toHaveBeenCalledWith({ ownerUserId: OWNER, memoryId: MEMORY_ID });
  });
});

describe("what the owner is shown", () => {
  it("names the memory an archive would take out of recall", async () => {
    stores.getMemory.mockResolvedValue({ content: "Ana is moving to Denver in August" });

    await expect(describeFor("archive_memory", { memoryId: MEMORY_ID })).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Archive a memory",
        lines: [
          "Memory: Ana is moving to Denver in August",
          "Archiving takes it out of recall and every normal view. The record is kept.",
        ],
      },
    });
  });

  it("shows a Gmail save's recipient, subject, and the message itself", async () => {
    stores.getDraft.mockResolvedValue({
      body: "Hi Sam - are you around on Friday?",
      personId: PERSON_ID,
      status: "approved",
    });
    stores.getPerson.mockResolvedValue({ displayName: "Sam Okafor" });

    await expect(
      describeFor("save_draft_to_gmail", {
        draftId: DRAFT_ID,
        recipientEmail: "sam@example.com",
        subject: "Friday",
      }),
    ).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Save this message to your Gmail drafts",
        lines: [
          "To: sam@example.com (Sam Okafor)",
          "Subject: Friday",
          "Message: Hi Sam - are you around on Friday?",
          "It is saved as a Gmail draft. Nothing is sent.",
        ],
      },
    });
  });

  it("shows both sides of a change, not just the new value", async () => {
    stores.getSelfContextFact.mockResolvedValue({
      category: "work",
      content: "I run a two-person consultancy",
      sensitivity: "normal",
    });

    const lookup = await describeFor("update_self_context", {
      contextFactId: MEMORY_ID,
      category: "work",
      content: "I run a four-person consultancy",
      sensitivity: "normal",
    });

    expect(lookup).toMatchObject({
      subject: {
        title: "Replace a fact about you",
        lines: ["Now: I run a two-person consultancy", "Becomes: I run a four-person consultancy"],
      },
    });
  });

  it("lists only the profile fields an update actually changes", async () => {
    stores.getPerson.mockResolvedValue({ displayName: "Mara Lind" });

    const lookup = await describeFor("update_person", {
      personId: PERSON_ID,
      birthday: "1990-03-03",
      profileBlurb: null,
    });

    expect(lookup).toEqual({
      kind: "described",
      subject: {
        title: "Change Mara Lind's profile",
        lines: ["Birthday: 1990-03-03", "Description: (cleared)"],
      },
    });
  });

  it("names the gift plan an idea is being taken off", async () => {
    stores.getGiftIdea.mockResolvedValue({
      idea: { title: "Wool scarf" },
      plan: { subjectName: "Ana" },
    });

    await expect(describeFor("remove_gift_idea", { giftIdeaId: IDEA_ID })).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Take your idea off the gift plan for Ana",
        lines: ["Idea: Wool scarf", "Removal is permanent: a plan keeps no archive of ideas."],
      },
    });
  });

  it("bounds a title and every line, however long the stored text is", async () => {
    stores.getMemory.mockResolvedValue({ content: "x".repeat(400) });

    const lookup = await describeFor("archive_memory", { memoryId: MEMORY_ID });
    if (lookup.kind !== "described") throw new Error("expected a description");

    expect(lookup.subject.title.length).toBeLessThanOrEqual(APPROVAL_SUBJECT_TITLE_MAX_LENGTH);
    for (const line of lookup.subject.lines) {
      expect(line.length).toBeLessThanOrEqual(APPROVAL_SUBJECT_LINE_MAX_LENGTH);
    }
    expect(lookup.subject.lines[0]).toMatch(/…$/);
  });
});

/**
 * A message is the one subject where the wording IS the risk, so it is the one
 * subject shown whole. `detail` collapses a body to a single 160-character line,
 * which asked an owner to authorise sending something they could read the first
 * sentence of.
 */
describe("paragraphs: a body, as the lines it is written in", () => {
  it("labels the first line and keeps the paragraph breaks", () => {
    expect(paragraphs("Message", "Hi Sam\n\nAre you around on Friday?\n\nMara")).toEqual([
      "Message: Hi Sam",
      "Are you around on Friday?",
      "Mara",
    ]);
  });

  it("has nothing to say about an empty body", () => {
    expect(paragraphs("Message", "")).toEqual([]);
    expect(paragraphs("Message", "   \n  \n ")).toEqual([]);
    expect(paragraphs("Message", null)).toEqual([]);
  });

  it("splits a paragraph too long to read as one line, at a word boundary", () => {
    const words = "lorem ipsum ".repeat(120).trim();
    const lines = paragraphs("Message", words);

    expect(lines.length).toBeGreaterThan(1);
    for (const entry of lines) {
      // The ceiling, prefix included: the labelled line is wrapped short by the
      // width of its own label so nothing it emits can pass this.
      expect(entry.length).toBeLessThanOrEqual(APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH);
      expect(entry).not.toMatch(/lore$|ipsu$/);
    }
    // Split, not cut: every word survives somewhere.
    expect(lines.join(" ").replace("Message: ", "")).toBe(words);
  });

  it("says how much it did not show once a body runs past the cap", () => {
    const body = "x".repeat(APPROVAL_SUBJECT_BODY_MAX_LENGTH + 250);
    const lines = paragraphs("Message", body);

    expect(lines.at(-1)).toBe("… (250 more characters)");
    expect(lines.slice(0, -1).join("").replace("Message: ", "")).toHaveLength(
      APPROVAL_SUBJECT_BODY_MAX_LENGTH,
    );
  });

  it("counts the paragraphs it never reached in what it did not show", () => {
    const lines = paragraphs(
      "Message",
      `${"x".repeat(APPROVAL_SUBJECT_BODY_MAX_LENGTH)}\n\n${"y".repeat(40)}`,
    );

    expect(lines.at(-1)).toBe("… (40 more characters)");
    expect(lines.join("")).not.toContain("y");
  });
});

describe("what a message approval shows", () => {
  const BODY = "Hi Sam\n\nAre you around on Friday? I wanted to ask about the move.\n\nMara";

  it("shows a Gmail save's whole message, not its opening line", async () => {
    stores.getDraft.mockResolvedValue({ body: BODY, personId: PERSON_ID, status: "approved" });
    stores.getPerson.mockResolvedValue({ displayName: "Sam Okafor" });

    await expect(
      describeFor("save_draft_to_gmail", {
        draftId: DRAFT_ID,
        recipientEmail: "sam@example.com",
        subject: "Friday",
      }),
    ).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Save this message to your Gmail drafts",
        lines: [
          "To: sam@example.com (Sam Okafor)",
          "Subject: Friday",
          "Message: Hi Sam",
          "Are you around on Friday? I wanted to ask about the move.",
          "Mara",
          "It is saved as a Gmail draft. Nothing is sent.",
        ],
      },
    });
  });

  it("shows the whole wording a rewrite would replace", async () => {
    stores.getDraft.mockResolvedValue({ body: BODY, personId: null, status: "approved" });

    await expect(
      describeFor("edit_draft_body", { draftId: DRAFT_ID, body: "Hi Sam - Friday?" }),
    ).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Rewrite a message draft",
        lines: [
          "Now: Hi Sam",
          "Are you around on Friday? I wanted to ask about the move.",
          "Mara",
          "Becomes: Hi Sam - Friday?",
          "This draft is approved. Rewriting it returns it to an unapproved draft.",
        ],
      },
    });
  });

  it("shows a long first paragraph whole, label and all", async () => {
    // `bounded` is the last word on length, and it re-truncates any line past
    // the paragraph ceiling. A first line wrapped to the full 600 and *then*
    // prefixed with "Message: " arrived 609 long, so the owner's approval card
    // silently lost the tail of the opening paragraph of the one message that
    // actually leaves Tendnote.
    const firstParagraph = "word ".repeat(140).trim();
    expect(firstParagraph.length).toBeGreaterThan(APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH);
    stores.getDraft.mockResolvedValue({
      body: `${firstParagraph}\n\nMara`,
      personId: null,
      status: "draft",
    });

    const lookup = await describeFor("save_draft_to_gmail", {
      draftId: DRAFT_ID,
      recipientEmail: "sam@example.com",
      subject: "Friday",
    });
    if (lookup.kind !== "described") throw new Error("expected a description");

    const body = lookup.subject.lines.slice(2, -1);
    for (const entry of body) {
      expect(entry).not.toContain("…");
      expect(entry.length).toBeLessThanOrEqual(APPROVAL_SUBJECT_PARAGRAPH_MAX_LENGTH);
    }
    // Split across lines, never cut: the paragraph is recoverable by joining them.
    expect(body.join(" ").replace("Message: ", "")).toBe(`${firstParagraph} Mara`);
  });

  it("still holds a labelled field to one line", async () => {
    // The 160-character bound is about fields, not about the message: a subject
    // line that scrolls is noise, and a body that stops is a missing decision.
    stores.getDraft.mockResolvedValue({ body: "Hi", personId: null, status: "draft" });

    const lookup = await describeFor("save_draft_to_gmail", {
      draftId: DRAFT_ID,
      recipientEmail: "sam@example.com",
      subject: "S".repeat(400),
    });
    if (lookup.kind !== "described") throw new Error("expected a description");

    const subjectLine = lookup.subject.lines.find((entry) => entry.startsWith("Subject: "));
    expect(subjectLine).toHaveLength(APPROVAL_SUBJECT_LINE_MAX_LENGTH);
    expect(subjectLine).toMatch(/…$/);
  });
});

/**
 * Every Change and Undo target the router can issue, resolved through the read
 * seam its own mutation applies. A kind with no case here is a kind whose forged
 * target reaches a lifecycle call undescribed, so the table is per kind rather
 * than per record family.
 */
describe("every capture target resolves in the caller's own scope", () => {
  const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
  const targets: ReadonlyArray<{
    kind: string;
    tool: "change_saved_item_capture" | "undo_saved_item_capture";
    target: Record<string, unknown>;
    store: keyof typeof stores;
    found: unknown;
    what: string;
  }> = [
    {
      kind: "edit_saved_item",
      tool: "change_saved_item_capture",
      target: { kind: "edit_saved_item", savedItemId: MEMORY_ID },
      store: "getSavedItem",
      found: { title: "Fix the porch light" },
      what: "saved item",
    },
    {
      kind: "archive_saved_item",
      tool: "undo_saved_item_capture",
      target: { kind: "archive_saved_item", savedItemId: MEMORY_ID },
      store: "getSavedItem",
      found: { title: "Fix the porch light" },
      what: "saved item",
    },
    {
      kind: "edit_general_action",
      tool: "change_saved_item_capture",
      target: { kind: "edit_general_action", generalActionId: MEMORY_ID },
      store: "getGeneralAction",
      found: { title: "Replace the filter" },
      what: "action",
    },
    {
      kind: "archive_general_action",
      tool: "undo_saved_item_capture",
      target: { kind: "archive_general_action", generalActionId: MEMORY_ID },
      store: "getGeneralAction",
      found: { title: "Replace the filter" },
      what: "action",
    },
    {
      kind: "edit_followup",
      tool: "change_saved_item_capture",
      target: { kind: "edit_followup", followupId: FOLLOWUP_ID },
      store: "getFollowup",
      found: { ownerUserId: OWNER, reason: "Check in about the move" },
      what: "follow-up",
    },
    {
      kind: "archive_followup",
      tool: "undo_saved_item_capture",
      target: { kind: "archive_followup", followupId: FOLLOWUP_ID },
      store: "getFollowup",
      found: { ownerUserId: OWNER, reason: "Check in about the move" },
      what: "follow-up",
    },
    {
      kind: "edit_memory",
      tool: "change_saved_item_capture",
      target: { kind: "edit_memory", memoryId: MEMORY_ID, sourceRecordId: SOURCE_ID },
      store: "getMemory",
      found: { content: "Ana moves in August" },
      what: "memory",
    },
    {
      kind: "archive_memory",
      tool: "undo_saved_item_capture",
      target: { kind: "archive_memory", memoryId: MEMORY_ID },
      store: "getMemory",
      found: { content: "Ana moves in August" },
      what: "memory",
    },
    {
      kind: "edit_person",
      tool: "change_saved_item_capture",
      target: { kind: "edit_person", personId: PERSON_ID, sourceRecordId: SOURCE_ID },
      store: "getPerson",
      found: { displayName: "Mara Lind" },
      what: "person",
    },
    {
      kind: "edit_asset_review",
      tool: "change_saved_item_capture",
      target: { kind: "edit_asset_review", groupId: MEMORY_ID, sourceRecordId: SOURCE_ID },
      store: "getAssetReviewGroup",
      found: { id: MEMORY_ID },
      what: "asset review",
    },
    {
      kind: "dismiss_asset_review",
      tool: "undo_saved_item_capture",
      target: { kind: "dismiss_asset_review", groupId: MEMORY_ID },
      store: "getAssetReviewGroup",
      found: { id: MEMORY_ID },
      what: "asset review",
    },
    {
      kind: "edit_context_fact",
      tool: "change_saved_item_capture",
      target: { kind: "edit_context_fact", contextFactId: MEMORY_ID, sourceRecordId: SOURCE_ID },
      store: "getSelfContextFact",
      found: { content: "I run a consultancy" },
      what: "fact about you",
    },
    {
      kind: "archive_context_fact",
      tool: "undo_saved_item_capture",
      target: { kind: "archive_context_fact", contextFactId: MEMORY_ID, sourceRecordId: SOURCE_ID },
      store: "getSelfContextFact",
      found: { content: "I run a consultancy" },
      what: "fact about you",
    },
  ];

  function inputFor(entry: (typeof targets)[number]) {
    return entry.tool === "change_saved_item_capture"
      ? { target: entry.target, originalText: "what the user said" }
      : { target: entry.target };
  }

  it("has a case for every kind the router can issue", () => {
    // Both discriminated unions, so a new target kind fails here rather than
    // silently resolving to nothing and denying a legitimate correction.
    expect([...new Set(targets.map((entry) => entry.kind))].sort()).toEqual(
      [
        ...new Set([
          ...conversationalCaptureChangeTargetSchema.options.map(
            (option) => option.shape.kind.value as string,
          ),
          ...conversationalCaptureUndoTargetSchema.options.map(
            (option) => option.shape.kind.value as string,
          ),
        ]),
      ].sort(),
    );
  });

  it.each(targets)("names the $what a $kind target points at", async (entry) => {
    stores[entry.store].mockResolvedValue(entry.found);

    const lookup = await describeFor(entry.tool, inputFor(entry));

    expect(lookup.kind).toBe("described");
    if (lookup.kind !== "described") return;
    expect(lookup.subject.title).toContain(entry.what);
  });

  it.each(targets)("is missing when a $kind target resolves to nothing", async (entry) => {
    stores[entry.store].mockResolvedValue(null);

    await expect(describeFor(entry.tool, inputFor(entry))).resolves.toEqual({ kind: "missing" });
  });

  it.each(targets.filter((entry) => entry.store === "getFollowup"))(
    "is missing when a $kind target names a record the caller may see but not change",
    async (entry) => {
      stores.getFollowup.mockResolvedValue({ ownerUserId: "user-2", reason: "Their reminder" });

      await expect(describeFor(entry.tool, inputFor(entry))).resolves.toEqual({ kind: "missing" });
    },
  );

  it("reads a Self Context target with the caller as their own resolver", async () => {
    // Restricted and archived facts are included deliberately: the target names a
    // fact the caller just changed, and hiding it would deny their own Undo.
    stores.getSelfContextFact.mockResolvedValue({ content: "I run a consultancy" });

    await describeFor("undo_saved_item_capture", {
      target: { kind: "archive_context_fact", contextFactId: MEMORY_ID, sourceRecordId: SOURCE_ID },
    });

    expect(stores.getSelfContextFact).toHaveBeenCalledWith(
      {
        callerUserId: OWNER,
        contextFactId: MEMORY_ID,
        includeRestricted: true,
        includeArchived: true,
      },
      expect.any(Function),
    );
  });
});

describe("a follow-up somebody else owns", () => {
  it("is missing even though the caller may see it", async () => {
    // Shared Follow-Ups are visible to a household member and read-only to
    // them, so the read seam answers while the mutation would refuse. The
    // approval must not park on a call that can never apply.
    stores.getFollowup.mockResolvedValue({ ownerUserId: "user-2", reason: "Check in" });

    await expect(
      describeFor("update_followup_status", { followupId: FOLLOWUP_ID, status: "archive" }),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("is described when it is the caller's own", async () => {
    stores.getFollowup.mockResolvedValue({
      ownerUserId: OWNER,
      reason: "Check in about the move",
      dueAt: new Date("2026-07-04T00:00:00.000Z"),
    });

    await expect(
      describeFor("update_followup_status", { followupId: FOLLOWUP_ID, status: "complete" }),
    ).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Mark a follow-up done",
        lines: ["Follow up: Check in about the move", "Due: 2026-07-04"],
      },
    });
  });
});

describe("a capture Undo target", () => {
  it("resolves the record the inverse would touch", async () => {
    stores.getSavedItem.mockResolvedValue({ title: "Fix the porch light" });

    await expect(
      describeFor("undo_saved_item_capture", {
        target: { kind: "archive_saved_item", savedItemId: MEMORY_ID },
      }),
    ).resolves.toEqual({
      kind: "described",
      subject: {
        title: "Undo the saved item you just captured",
        lines: ["Undoing: Fix the porch light", "The note it came from is kept."],
      },
    });
  });

  it("refuses a forged follow-up target naming another member's reminder", async () => {
    // The composition the finding named: a shared Follow-Up is visible to a
    // household member, and an undo target is model-supplied text.
    stores.getFollowup.mockResolvedValue({ ownerUserId: "user-2", reason: "Their reminder" });

    await expect(
      describeFor("undo_saved_item_capture", {
        target: { kind: "archive_followup", followupId: FOLLOWUP_ID },
      }),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("refuses a target whose discriminator is not one Capture issues", async () => {
    await expect(
      describeFor("undo_saved_item_capture", {
        target: { kind: "delete_everything", savedItemId: MEMORY_ID },
      }),
    ).resolves.toEqual({ kind: "missing" });
  });
});

/**
 * The registry's schemas are subsets of the tools' own input schemas, so the two
 * can drift apart silently: a renamed field would make every real call parse-fail
 * and deny, and nothing else in the build would notice. One representative input
 * per describer, transcribed from the tool that sends it, is the check.
 */
describe("every describer accepts the input its tool actually sends", () => {
  const ID = FOLLOWUP_ID;
  const inputs: Record<string, unknown> = {
    accept_suggested_followup: {
      followupId: ID,
      edit: { reason: "Check in", dueAt: "2026-07-04" },
    },
    accept_suggested_general_action: {
      generalActionId: ID,
      edit: { title: "Replace the filter", notes: null, dueAt: null },
    },
    add_gift_idea: {
      giftPlanId: ID,
      title: "Wool scarf",
      note: "The grey one",
      url: "https://x.example",
    },
    approve_suggested_memory: {
      memoryId: ID,
      edit: { content: "Ana moves in August", sensitivity: "normal" },
    },
    archive_memory: { memoryId: ID },
    archive_self_context: { contextFactId: ID, expectedUpdatedAt: "2026-07-04T00:00:00.000Z" },
    capture_memory: { personId: ID, request: "Remember Caleb is moving", sensitivity: "normal" },
    capture_source_record: {
      retainedContent: "Ana mentioned the move",
      personId: ID,
      sensitivity: "normal",
    },
    change_saved_item_capture: {
      originalText: "fix the porch light",
      clarificationAnswer: "the back one",
      target: { kind: "edit_saved_item", savedItemId: ID },
    },
    create_followup: { personId: ID, reason: "Check in about the move", dueAt: "2026-07-04" },
    dismiss_draft: { draftId: ID },
    dismiss_suggested_followup: { followupId: ID },
    dismiss_suggested_general_action: { generalActionId: ID },
    dismiss_suggested_memory: { memoryId: ID },
    edit_asset: { assetId: ID, name: "Kitchen fridge", kind: "appliance" },
    edit_draft_body: { draftId: ID, body: "Hi Sam - Friday?" },
    edit_general_action: {
      generalActionId: ID,
      title: "Replace the filter",
      notes: null,
      dueAt: null,
      recurrence: { interval: 6, unit: "month" },
      areaId: ID,
      links: [],
    },
    edit_gift_idea: { giftIdeaId: ID, title: "Cashmere scarf", note: null, url: null },
    remove_gift_idea: { giftIdeaId: ID },
    restore_self_context: { contextFactId: ID, expectedArchivedAt: "2026-07-04T00:00:00.000Z" },
    save_draft_to_gmail: { draftId: ID, recipientEmail: "sam@example.com", subject: "Friday" },
    undo_saved_item_capture: { target: { kind: "archive_memory", memoryId: ID } },
    update_followup_status: { followupId: ID, status: "snooze", dueAt: "2026-07-11" },
    update_general_action_status: {
      generalActionId: ID,
      action: "defer",
      deferUntil: "2026-07-11",
    },
    update_person: {
      personId: ID,
      displayName: "Samuel",
      birthday: "1990-03-03",
      profileBlurb: null,
    },
    update_self_context: {
      contextFactId: ID,
      category: "work",
      content: "I run a consultancy",
      sensitivity: "normal",
    },
  };

  beforeEach(() => {
    stores.getAsset.mockResolvedValue({ name: "Kitchen fridge", kind: "appliance" });
    stores.getAssetReviewGroup.mockResolvedValue({ id: ID });
    stores.getDraft.mockResolvedValue({ body: "Hi Sam", personId: PERSON_ID, status: "draft" });
    stores.getFollowup.mockResolvedValue({ ownerUserId: OWNER, reason: "Check in", dueAt: null });
    stores.getGeneralAction.mockResolvedValue({ title: "Replace the filter", dueAt: null });
    stores.getGiftIdea.mockResolvedValue({
      idea: { title: "Wool scarf" },
      plan: { subjectName: "Ana" },
    });
    stores.getGiftPlan.mockResolvedValue({ subjectName: "Ana" });
    stores.getMemory.mockResolvedValue({ content: "Ana moves in August" });
    stores.getPerson.mockResolvedValue({ displayName: "Sam Okafor" });
    stores.getSavedItem.mockResolvedValue({ title: "Fix the porch light" });
    stores.getSelfContextFact.mockResolvedValue({
      category: "work",
      content: "I run a consultancy",
      sensitivity: "normal",
    });
  });

  it("has a representative input for every registered tool", () => {
    expect(Object.keys(inputs).sort()).toEqual([...APPROVAL_SUBJECT_TOOL_NAMES]);
  });

  it.each(Object.keys(inputs).sort())("%s describes what it is about", async (toolName) => {
    const lookup = await describeFor(toolName, inputs[toolName]);

    expect(lookup.kind, `${toolName} did not describe its own tool's input`).toBe("described");
    if (lookup.kind !== "described") return;
    expect(lookup.subject.title.length).toBeGreaterThan(0);
    expect(lookup.subject.lines.length).toBeGreaterThan(0);
  });
});
