import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryFollowupLifecycleStore } from "./in-memory-store";
import {
  createAffectedFollowupLifecycle,
  createAffectedSuggestedFollowupReview,
} from "./mutation-lifecycle";

const OWNER = "owner-1";

function expectedFollowupScopes(personId: string, options: { review?: boolean } = {}) {
  return [
    { kind: "owner-collection", collection: "people", ownerUserId: OWNER },
    { kind: "viewer-entity", entity: "person", entityId: personId, viewerUserId: OWNER },
    { kind: "visible-entity", entity: "person", entityId: personId },
    { kind: "owner-collection", collection: "today", ownerUserId: OWNER },
    ...(options.review
      ? [{ kind: "owner-collection", collection: "review", ownerUserId: OWNER }]
      : []),
  ];
}

async function setup() {
  const store = createInMemoryFollowupLifecycleStore();
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
  return { store, person };
}

describe("Follow-Up affected-scope contract", () => {
  it("routes production Follow-Up writes through both affected-scope seams", () => {
    // This repo has no live Drizzle adapter harness. Per #315, the production
    // half of the store contract is an intentional source-wiring guard; the
    // behavioral half runs against the in-memory adapter below.
    const source = readFileSync(join(import.meta.dirname, "..", "followups.ts"), "utf8");
    expect(source).toContain("createAffectedFollowupLifecycle(defaultFollowupStore)");
    expect(source).toContain("createAffectedSuggestedFollowupReview(defaultFollowupStore)");
  });

  it("returns the same person and Today scopes for every active lifecycle mutation", async () => {
    const { store, person } = await setup();
    const lifecycle = createAffectedFollowupLifecycle(store);
    const expected = expectedFollowupScopes(person.id);

    const created = await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Check in about the move.",
      dueAt: new Date("2026-08-01T00:00:00Z"),
    });
    expect(created.affectedScopes).toEqual(expected);

    const edited = await lifecycle.editFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
      edit: { reason: "Check in about the new house." },
    });
    expect(edited.affectedScopes).toEqual(expected);

    const snoozed = await lifecycle.snoozeFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
      dueAt: new Date("2026-08-03T00:00:00Z"),
    });
    expect(snoozed.affectedScopes).toEqual(expected);

    const completed = await lifecycle.completeFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
    });
    expect(completed.affectedScopes).toEqual(expected);

    const reopened = await lifecycle.reopenFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
    });
    expect(reopened.affectedScopes).toEqual(expected);

    const dismissed = await lifecycle.dismissFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
    });
    expect(dismissed.affectedScopes).toEqual(expected);

    const reopenedAgain = await lifecycle.reopenFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
    });
    expect(reopenedAgain.affectedScopes).toEqual(expected);

    const archived = await lifecycle.archiveFollowup({
      actorUserId: OWNER,
      followupId: created.result.id,
    });
    expect(archived.affectedScopes).toEqual(expected);
  });

  it("adds Review scopes for suggested Follow-Up mutations", async () => {
    const { store, person } = await setup();
    const review = createAffectedSuggestedFollowupReview(store);
    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara starts a new role next month.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const expected = expectedFollowupScopes(person.id, { review: true });

    const suggested = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Ask how the new role is going.",
      dueAt: new Date("2026-08-15T00:00:00Z"),
      sourceRecordId: source.id,
    });
    expect(suggested.affectedScopes).toEqual(expected);

    const edited = await review.editSuggestedFollowup({
      actorUserId: OWNER,
      followupId: suggested.result.followup.id,
      edit: { reason: "Ask how the new team is going." },
    });
    expect(edited.affectedScopes).toEqual(expected);

    const accepted = await review.acceptSuggestedFollowup({
      actorUserId: OWNER,
      followupId: suggested.result.followup.id,
    });
    expect(accepted.affectedScopes).toEqual(expected);

    const anotherSuggestion = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Ask how the first week went.",
      dueAt: new Date("2026-08-22T00:00:00Z"),
      sourceRecordId: source.id,
    });
    const dismissed = await review.dismissSuggestedFollowup({
      actorUserId: OWNER,
      followupId: anotherSuggestion.result.followup.id,
    });
    expect(dismissed.affectedScopes).toEqual(expected);
  });
});
