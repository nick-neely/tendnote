import type { CreateMessageDraftInput, Person } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryDraftLifecycleStore } from "./in-memory-store";
import { createAffectedDraftLifecycle, draftGenerationOutcome } from "./mutation-lifecycle";

const OWNER = "owner-1";

function expectedDraftScopes(personId: string) {
  return [
    { kind: "owner-collection", collection: "people", ownerUserId: OWNER },
    { kind: "viewer-entity", entity: "person", entityId: personId, viewerUserId: OWNER },
    { kind: "visible-entity", entity: "person", entityId: personId },
  ];
}

function draftInput(person: Person): CreateMessageDraftInput {
  return {
    ownerUserId: OWNER,
    personId: person.id,
    channel: "text",
    purpose: "check_in",
    body: "How is the new role going?",
    status: "draft",
    sourceRefs: [
      {
        kind: "source_record",
        id: "source-1",
        label: "Started a new role",
        trust: "logged_context",
      },
    ],
  };
}

describe("Message Draft affected-scope contract", () => {
  it("routes production lifecycle, generation, and regeneration through the seam", () => {
    // This repo has no live Drizzle adapter harness. Per #315, the production
    // half of the store contract is an intentional source-wiring guard; the
    // behavioral half runs against the in-memory adapter below.
    const source = readFileSync(join(import.meta.dirname, "..", "drafts.ts"), "utf8");
    expect(source).toContain("createAffectedDraftLifecycle(defaultDraftLifecycleStore)");
    expect(source).toContain("createAffectedDraftGenerator(defaultDraftGenerator)");
    expect(source).toContain("createAffectedDraftRegeneration(defaultDraftRegeneration)");
  });

  it("returns the same person scopes for each lifecycle mutation", async () => {
    const store = createInMemoryDraftLifecycleStore();
    const person = await store.createPerson({
      ownerUserId: OWNER,
      displayName: "Mara Lin",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const lifecycle = createAffectedDraftLifecycle(store);
    const expected = expectedDraftScopes(person.id);

    const forApproval = await store.createDraft(draftInput(person));
    const approved = await lifecycle.approveDraft({
      ownerUserId: OWNER,
      draftId: forApproval.id,
    });
    expect(approved.affectedScopes).toEqual(expected);

    const forDismissal = await store.createDraft(draftInput(person));
    const dismissed = await lifecycle.dismissDraft({
      ownerUserId: OWNER,
      draftId: forDismissal.id,
    });
    expect(dismissed.affectedScopes).toEqual(expected);

    const forSent = await store.createDraft(draftInput(person));
    const sent = await lifecycle.markDraftSentManually({
      ownerUserId: OWNER,
      draftId: forSent.id,
    });
    expect(sent.affectedScopes).toEqual(expected);

    const forEdit = await store.createDraft(draftInput(person));
    const edited = await lifecycle.editDraftBody({
      ownerUserId: OWNER,
      draftId: forEdit.id,
      body: "How are the new role and team going?",
    });
    expect(edited.affectedScopes).toEqual(expected);

    expect(
      draftGenerationOutcome({ status: "created", draft: edited.result }).affectedScopes,
    ).toEqual(expected);
    expect(
      draftGenerationOutcome({ status: "skipped", reason: "insufficient_context" }).affectedScopes,
    ).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
