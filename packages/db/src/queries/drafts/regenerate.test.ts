import type { CreateMessageDraftInput, Person } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import type { GenerateDraftInput, GenerateDraftOutcome } from "./generator";
import { createInMemoryDraftLifecycleStore } from "./in-memory-store";
import { createDraftRegeneration } from "./regenerate";
import type { InMemoryDraftLifecycleStore } from "./types";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

function draftInput(person: Person, overrides: Partial<CreateMessageDraftInput> = {}) {
  return {
    ownerUserId: OWNER,
    personId: person.id,
    channel: "text" as const,
    purpose: "check_in" as const,
    body: "Original draft body.",
    status: "draft" as const,
    sourceRefs: [
      {
        kind: "followup" as const,
        id: "fu-1",
        label: "check in after the move",
        trust: "intent" as const,
      },
    ],
    ...overrides,
  };
}

async function setup() {
  const store: InMemoryDraftLifecycleStore = createInMemoryDraftLifecycleStore();

  const person = await store.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  // Records the inputs the generator received and creates a fresh draft, so the
  // regeneration flow is exercised without the real adapter/person context.
  const generateCalls: GenerateDraftInput[] = [];
  async function fakeGenerate(input: GenerateDraftInput): Promise<GenerateDraftOutcome> {
    generateCalls.push(input);
    const draft = await store.createDraft({
      ownerUserId: input.ownerUserId,
      personId: input.personId,
      channel: input.channel ?? "text",
      purpose: input.purpose ?? "other",
      body: "Regenerated draft body.",
      status: "draft",
      sourceRefs: [],
    });
    return { status: "created", draft };
  }

  const auditActions = async () =>
    (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { store, person, generateCalls, fakeGenerate, auditActions };
}

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

describe("draft regeneration", () => {
  it("creates a new draft, leaves the prior untouched, and audits the link", async () => {
    const prior = await ctx.store.createDraft(draftInput(ctx.person));
    const regeneration = createDraftRegeneration({
      store: ctx.store,
      generateDraft: ctx.fakeGenerate,
    });

    const outcome = await regeneration.regenerateDraft({ ownerUserId: OWNER, draftId: prior.id });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    // A new record — the reviewed prior draft is never silently replaced.
    expect(outcome.draft.id).not.toBe(prior.id);
    const priorAfter = await ctx.store.getDraft({ ownerUserId: OWNER, draftId: prior.id });
    expect(priorAfter?.body).toBe("Original draft body.");
    expect(priorAfter?.status).toBe("draft");

    // Grounding intent (the follow-up) is carried into the regenerate call.
    expect(ctx.generateCalls[0]?.followupContext).toEqual({
      id: "fu-1",
      reason: "check in after the move",
    });
    expect(ctx.generateCalls[0]?.purpose).toBe("check_in");

    expect(await ctx.auditActions()).toContain("message_draft.regenerated");
  });

  it("does not audit when generation is skipped", async () => {
    const prior = await ctx.store.createDraft(draftInput(ctx.person));
    const regeneration = createDraftRegeneration({
      store: ctx.store,
      generateDraft: async () => ({ status: "skipped", reason: "insufficient_context" }),
    });

    const outcome = await regeneration.regenerateDraft({ ownerUserId: OWNER, draftId: prior.id });

    expect(outcome).toEqual({ status: "skipped", reason: "insufficient_context" });
    expect(await ctx.auditActions()).not.toContain("message_draft.regenerated");
  });

  it("does not regenerate another owner's draft", async () => {
    const prior = await ctx.store.createDraft(draftInput(ctx.person));
    const regeneration = createDraftRegeneration({
      store: ctx.store,
      generateDraft: ctx.fakeGenerate,
    });

    await expect(
      regeneration.regenerateDraft({ ownerUserId: OTHER_OWNER, draftId: prior.id }),
    ).rejects.toThrow();
    expect(ctx.generateCalls).toHaveLength(0);
  });
});
