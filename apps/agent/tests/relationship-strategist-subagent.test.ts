import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectAllMatch } from "./instruction-expectations";
import { authoredInstructions } from "./instructions-source";
import { asTestTool, parseToolInput, toolModelValue } from "./test-tool";

const { getRelationshipAgenda, suggestFollowup, listDraftsForPerson, getPerson, searchPeople } =
  vi.hoisted(() => ({
    getRelationshipAgenda: vi.fn(),
    suggestFollowup: vi.fn(),
    listDraftsForPerson: vi.fn(),
    getPerson: vi.fn(),
    searchPeople: vi.fn(),
  }));

vi.mock("@tendnote/db/queries/relationship-agenda", () => ({ getRelationshipAgenda }));
vi.mock("@tendnote/db/queries/followups", () => ({ suggestFollowup }));
vi.mock("@tendnote/db/queries/drafts", () => ({
  listDraftsForPerson,
  listDraftsForOwner: vi.fn(),
}));
vi.mock("@tendnote/db/queries/people", () => ({ getPerson, searchPeople }));

const subagentRoot = join(process.cwd(), "agent/subagents/relationship_strategist");
const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const FOLLOWUP_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_RECORD_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function toolSource(file: string): string {
  return readFileSync(join(subagentRoot, "tools", file), "utf8");
}

function instructions(): string {
  return readFileSync(join(subagentRoot, "instructions/base.md"), "utf8");
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
    expectAllMatch(instructions(), [
      /get_relationship_agenda/i,
      /read-only ranking surface/i,
      /list_calendar_events/i,
      /Calendar output is provider-derived context/i,
      /list_message_drafts/i,
      /Draft reads are read-only/i,
      /propose_followup/i,
      /concrete `sourceRecordId`/i,
      /must not create active Follow-Ups/i,
      /must not create .*Memories/i,
      /create Source Records/i,
      /create Message Drafts/i,
      /external actions/i,
    ]);
  });

  /**
   * ADR 0124's path was unreachable: `propose_followup` requires a `personId`, and a
   * subagent inherits no conversation to have learned one from. The parent passing one
   * is the normal case; being able to resolve a name itself is what keeps a delegation
   * that forgot from dead-ending.
   */
  it("can reach a personId from the delegated message and from its own lookup", () => {
    expectAllMatch(instructions(), [
      /carries the exact `personId`/i,
      /search_people/,
      /hand the choice back to the parent agent/i,
      /never ask the owner for a raw id/i,
    ]);
    // The parent's own contract has to agree with the child's.
    expect(authoredInstructions()).toMatch(/Pass\s+the resolved `personId` for every person/i);
  });

  it("keeps its anti-CRM, anti-guilt tone rules", () => {
    expectAllMatch(instructions(), [
      /non-salesy/i,
      /relationship impact/,
      /lead\/deal\/pipeline language/,
      /Do not guilt the owner/i,
      /thoughtful options the owner can consider/i,
    ]);
  });

  /**
   * The four tools were hand-copied from the root's and had drifted apart in exactly
   * the direction that costs safety: the copies dropped clauses. They are registrations
   * over one shared definition now, so a clause can only be removed from both at once.
   */
  it("registers shared tool definitions instead of re-implementing them", () => {
    for (const file of [
      "get_relationship_agenda.ts",
      "list_calendar_events.ts",
      "list_message_drafts.ts",
      "propose_followup.ts",
      "search_people.ts",
    ]) {
      const source = toolSource(file);
      expect(source, file).toMatch(/from "\.\.\/\.\.\/\.\.\/lib\/tools\//);
      expect(source, file).not.toMatch(/async\s+execute\s*\(/);
      expect(source, file).not.toMatch(/@tendnote\/db\/queries/);
    }
  });

  it("keeps both refusal clauses on the suggestion path, for the root and the subagent", () => {
    const shared = readFileSync(join(process.cwd(), "agent/lib/tools/propose-followup.ts"), "utf8");
    expectAllMatch(shared, [
      /Do NOT use this to scan everyone and invent follow-ups/,
      /do NOT rank who to check in with/,
      /never an active reminder/,
    ]);
    // The one field that used to describe source refs as an identity lookup.
    expect(shared).toMatch(/Resolve identity with search_people first/);
    expect(shared).not.toMatch(/agenda source refs or identity lookup/);
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
    const { default: rawAgendaTool } = await import(
      "../agent/subagents/relationship_strategist/tools/get_relationship_agenda"
    );
    const agendaTool = asTestTool(rawAgendaTool);

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

    // The handles its own propose_followup call needs, and the rule that they are
    // handles: without them the subagent has a ranking it can do nothing with.
    const model = toolModelValue(rawAgendaTool, result) as {
      candidates: { person: string; personId: string; sourceRefs: unknown[] }[];
      guidance: string;
    };
    expect(model.candidates[0]?.person).toBe("Alex");
    expect(model.candidates[0]?.personId).toBe(PERSON_ID);
    expect(model.candidates[0]?.sourceRefs).toEqual([
      { kind: "source_record", id: SOURCE_RECORD_ID },
    ]);
    expect(model.guidance).toMatch(/never write one in a reply/i);
    expect(model.guidance).toMatch(/read-only agenda context/i);
  });

  it("executes grounded Suggested Follow-Up creation through the review-gated shared path", async () => {
    suggestFollowup.mockResolvedValue({
      affectedScopes: [],
      result: {
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
      },
    });
    const { default: rawProposalTool } = await import(
      "../agent/subagents/relationship_strategist/tools/propose_followup"
    );
    const proposalTool = asTestTool(rawProposalTool);

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

    const model = toolModelValue(rawProposalTool, result);
    expect(model.guidance).toMatch(/tentative/i);
    expect(model.guidance).toMatch(/do not claim it was accepted/i);
  });

  it("resolves a name to a personId without being able to create anyone", async () => {
    searchPeople.mockResolvedValue([
      { id: PERSON_ID, displayName: "Alex", relationshipType: "friend", closenessLevel: 3 },
    ]);
    const { default: rawSearchTool } = await import(
      "../agent/subagents/relationship_strategist/tools/search_people"
    );
    const searchTool = asTestTool(rawSearchTool);

    const result = await searchTool.execute(parseToolInput(rawSearchTool, { query: "Alex" }), ctx);

    expect(searchPeople).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "user-1" }));
    expect(result.people[0]?.id).toBe(PERSON_ID);
    expect(result.requiresDisambiguation).toBe(false);
    expect(rawSearchTool.description).toMatch(/cannot create a person/i);
  });

  it("executes draft reads as owner-scoped, person-scoped, bounded, and id-free", async () => {
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
    getPerson.mockResolvedValue({ id: PERSON_ID, displayName: "Alex" });
    const { default: rawDraftTool } = await import(
      "../agent/subagents/relationship_strategist/tools/list_message_drafts"
    );
    const draftTool = asTestTool(rawDraftTool);

    const input = parseToolInput(rawDraftTool, { personId: PERSON_ID, statuses: ["draft"] });
    const result = await draftTool.execute(input, ctx);

    expect(listDraftsForPerson).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      personId: PERSON_ID,
      statuses: ["draft"],
    });
    expect(result.drafts).toHaveLength(1);

    // The old copy required a personId it could not obtain, returned every draft the
    // person ever had, and passed the grounding record ids to the model.
    const model = toolModelValue(rawDraftTool, result);
    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain(SOURCE_RECORD_ID);
    expect(serialized).not.toContain(DRAFT_ID);
    expect(serialized).not.toContain(PERSON_ID);
    expect(serialized).toContain("Alex");
    expect(model.guidance).toMatch(/never been sent|has been sent or exported/i);
    expect(model.guidance).toMatch(/parent agent/i);
  });

  it("bounds one person's drafts to a page the turn can carry", () => {
    const shared = readFileSync(join(process.cwd(), "agent/lib/tools/message-drafts.ts"), "utf8");
    expect(shared).toMatch(/DEFAULT_DRAFT_LIST_LIMIT = 5/);
    expect(shared).toMatch(/\.max\(25\)/);
  });
});
