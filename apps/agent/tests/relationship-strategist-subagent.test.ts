import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authoredInstructions } from "./instructions-source";

const { getRelationshipAgenda, suggestFollowup, listDraftsForPerson } = vi.hoisted(() => ({
  getRelationshipAgenda: vi.fn(),
  suggestFollowup: vi.fn(),
  listDraftsForPerson: vi.fn(),
}));

vi.mock("@tendnote/db/queries/relationship-agenda", () => ({ getRelationshipAgenda }));
vi.mock("@tendnote/db/queries/followups", () => ({ suggestFollowup }));
vi.mock("@tendnote/db/queries/drafts", () => ({ listDraftsForPerson }));

const subagentRoot = join(process.cwd(), "agent/subagents/relationship_strategist");
const PERSON_ID = "11111111-1111-1111-1111-111111111111";
const FOLLOWUP_ID = "22222222-2222-2222-2222-222222222222";
const SOURCE_RECORD_ID = "33333333-3333-3333-3333-333333333333";
const DRAFT_ID = "44444444-4444-4444-4444-444444444444";
const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Relationship Strategist subagent", () => {
  it("is declared as a private strategy specialist the parent can delegate to", () => {
    const source = readFileSync(join(subagentRoot, "agent.ts"), "utf8");
    expect(source).toContain("defineAgent");
    expect(source).toMatch(/relationship strategy/i);
    expect(authoredInstructions()).toMatch(/relationship_strategist/);
    expect(authoredInstructions()).toMatch(/Suggested Follow-Ups/);
  });

  it("blocks durable and external mutations inside isolated instructions", () => {
    const instructions = readFileSync(join(subagentRoot, "instructions.md"), "utf8");
    expect(instructions).toMatch(/get_relationship_agenda/i);
    expect(instructions).toMatch(/read-only ranking surface/i);
    expect(instructions).toMatch(/list_calendar_events/i);
    expect(instructions).toMatch(/Calendar output is provider-derived context/i);
    expect(instructions).toMatch(/list_message_drafts/i);
    expect(instructions).toMatch(/Draft reads are read-only/i);
    expect(instructions).toMatch(/propose_followup/i);
    expect(instructions).toMatch(/concrete `sourceRecordId`/i);
    expect(instructions).toMatch(/must not create active Follow-Ups/i);
    expect(instructions).toMatch(/must not create .*Memories/i);
    expect(instructions).toMatch(/create Source Records/i);
    expect(instructions).toMatch(/create Message Drafts/i);
    expect(instructions).toMatch(/external actions/i);
  });

  it("keeps relationship agenda read-only and separate from suggested follow-up mutation", () => {
    const agendaTool = readFileSync(join(subagentRoot, "tools/get_relationship_agenda.ts"), "utf8");
    expect(agendaTool).toContain("getRelationshipAgenda");
    expect(agendaTool).toContain("resolveOwnerUserId");
    expect(agendaTool).toContain("sourceRefs");
    expect(agendaTool).toMatch(/read-only/i);
    expect(importsOf(agendaTool)).not.toEqual(
      expect.arrayContaining(["@tendnote/db/queries/followups"]),
    );
    expect(agendaTool).not.toMatch(
      /\b(suggestFollowup|createFollowup|createMemory|captureSourceRecord|generateDraft|saveDraft)\s*\(/,
    );
  });

  it("creates only grounded review-gated Suggested Follow-Ups with owner scoping", () => {
    const proposalTool = readFileSync(join(subagentRoot, "tools/propose_followup.ts"), "utf8");
    expect(proposalTool).toContain("suggestFollowup");
    expect(proposalTool).toContain("resolveOwnerUserId");
    expect(proposalTool).toMatch(/sourceRecordId/);
    expect(proposalTool).toMatch(/status:\s*result\.followup\.status/);
    expect(proposalTool).toMatch(/Suggested Follow-Up/i);
    expect(importsOf(proposalTool)).not.toEqual(
      expect.arrayContaining([
        "@tendnote/db/queries/memories",
        "@tendnote/db/queries/source-records",
        "@tendnote/db/queries/drafts",
        "@tendnote/db/queries/gmail-drafts",
      ]),
    );
    expect(proposalTool).not.toMatch(
      /\b(createFollowup|acceptSuggestedFollowup|dismissSuggestedFollowup|createMemory|captureSourceRecord|generateDraft|saveDraft|send)\s*\(/,
    );
  });

  it("executes the agenda tool as an owner-scoped read with no suggested-follow-up mutation", async () => {
    getRelationshipAgenda.mockResolvedValue([
      {
        kind: "recent_context",
        personId: PERSON_ID,
        personDisplayName: "Alex",
        title: "Alex mentioned the job search",
        reason: "Recent logged context may make a check-in thoughtful.",
        dueAt: new Date("2026-07-06T00:00:00.000Z"),
        sourceRefs: [{ kind: "source_record", id: SOURCE_RECORD_ID }],
        trustLevel: "logged_context",
        sensitivity: "normal",
        rank: 1,
      },
    ]);
    const { default: agendaTool } = await import(
      "../agent/subagents/relationship_strategist/tools/get_relationship_agenda"
    );

    const result = await agendaTool.execute(
      {
        windowStart: "2026-07-01T00:00:00.000Z",
        windowEnd: "2026-07-08T00:00:00.000Z",
        query: "who should I prioritize this week?",
        includeKinds: ["recent_context"],
        directlyRequested: false,
      },
      ctx,
    );

    expect(getRelationshipAgenda).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        query: "who should I prioritize this week?",
        includeKinds: ["recent_context"],
        directlyRequested: false,
      }),
    );
    expect(suggestFollowup).not.toHaveBeenCalled();
    expect(result.component).toEqual({ type: "relationship_agenda", resultCount: 1 });
    expect(result.candidates[0]?.sourceRefs).toEqual([
      { kind: "source_record", id: SOURCE_RECORD_ID },
    ]);
  });

  it("executes grounded Suggested Follow-Up creation through the review-gated shared path", async () => {
    suggestFollowup.mockResolvedValue({
      component: {
        type: "suggested_followup",
        followupId: FOLLOWUP_ID,
        sourceRecordId: SOURCE_RECORD_ID,
      },
      person: { id: PERSON_ID, displayName: "Alex" },
      followup: {
        id: FOLLOWUP_ID,
        personId: PERSON_ID,
        reason: "Check in about the job search.",
        dueAt: new Date("2026-07-06T00:00:00.000Z"),
        status: "suggested",
      },
      sourceRecord: { id: SOURCE_RECORD_ID },
    });
    const { default: proposalTool } = await import(
      "../agent/subagents/relationship_strategist/tools/propose_followup"
    );

    const result = await proposalTool.execute(
      {
        personId: PERSON_ID,
        reason: "Check in about the job search.",
        dueAt: "2026-07-06T00:00:00.000Z",
        sourceRecordId: SOURCE_RECORD_ID,
      },
      ctx,
    );

    expect(suggestFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        personId: PERSON_ID,
        reason: "Check in about the job search.",
        sourceRecordId: SOURCE_RECORD_ID,
      }),
    );
    expect(result.followup.status).toBe("suggested");
    expect(result.component.followupId).toBe(FOLLOWUP_ID);
  });

  it("executes draft reads as owner-scoped, person-scoped, read-only context", async () => {
    listDraftsForPerson.mockResolvedValue([
      {
        id: DRAFT_ID,
        personId: PERSON_ID,
        channel: "text",
        purpose: "check_in",
        status: "draft",
        body: "Hey Alex, how is the job search going?",
        sourceRefs: [
          {
            kind: "source_record",
            id: SOURCE_RECORD_ID,
            label: "Alex mentioned job search",
            trust: "logged_context",
          },
        ],
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ]);
    const { default: draftTool } = await import(
      "../agent/subagents/relationship_strategist/tools/list_message_drafts"
    );

    const result = await draftTool.execute({ personId: PERSON_ID, statuses: ["draft"] }, ctx);

    expect(listDraftsForPerson).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      personId: PERSON_ID,
      statuses: ["draft"],
    });
    expect(result.drafts).toHaveLength(1);
    expect(result.guidance).toMatch(/read-only|explicit owner intent/i);
  });
});
